> English: [en/development.md](en/development.md)

# 開発とテスト

Kumiori の開発の進め方と、手元での動かし方・テストの方法です。公開の手順は [`docs/RELEASING.md`](RELEASING.md)、版ごとの変更は [`CHANGELOG.md`](../CHANGELOG.md) にあります。

- [開発の方法](#開発の方法)
- [手元で動かす](#手元で動かす)
- [テスト](#テスト)
- [CI と同じ手順を手元で (npm run ci:local)](#ci-と同じ手順を手元で-npm-run-cilocal)
- [テストが取るデータ](#テストが取るデータ)
- [タグ付き PDF の検査 (veraPDF)](#タグ付き-pdf-の検査-verapdf)
- [見本の PDF との比較](#見本の-pdf-との比較)

## 開発の方法

Kumiori は、AI のコーディング支援 (Anthropic の [Claude Code](https://claude.com/claude-code)) を使って開発しています。

- コード・テスト・ドキュメントの多くは、AI が書いたものです。何を作るか、どの仕様にどう従うかは人が決めます。
- 組版の結果は人が確かめ、直す点を指示し、レビューしたうえで取り込んでいます。
- 仕様の解釈は、仕様書を読み、公開されている見本の PDF と組んだ結果を見比べて確かめています。
- 機能を足すたびにテストを書き足し、型チェック・単体テスト・ブラウザでの結合テストを通しています。
- 第三者のコードやライセンスの混入は、公開前にツールで点検しています ([THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md))。

### 根拠にしている規格・仕様書

XSL-FO 1.1、CSS の各モジュール (Paged Media・GCPM・Writing Modes・Text・Ruby・Fragmentation など)、MathML Core、Unicode の UAX #9 (双方向) と UAX #14 (改行)、W3C の JLREQ (日本語組版処理の要件。JIS X 4051 に基づく)、PDF (ISO 32000) などの規格・仕様書を可能な限り読み、その定義に沿って実装しています。
約物の詰め・ぶら下げ・ルビのはみ出しなど、日本語組版の細部も規格に基づいています。
プロパティごとの対応状況と、仕様の定義・Kumiori での扱いは、対応仕様説明書 ([`docs/conformance/`](conformance/README.md)) にまとめています。

XSL-FO や CSS の組版ソフトが公開している見本の PDF と、Kumiori で組んだ結果を見比べて、仕様の解釈や細かな組み方を確かめています ([見本の PDF との比較](#見本の-pdf-との比較))。

## 手元で動かす

```bash
npm install
npm run dev          # http://localhost:5173  (プレビュー + 「PDF を保存」)
npm run build        # 型チェック + 本番ビルド (dist/。画面)
npm run build:dist   # ライブラリ (dist-lib)・Node のコマンド (dist-cli)・ブラウザ用の 1 ファイル (dist-browser) をまとめて作る
npm run docs:api     # API の説明書 (dist/api/)
```

Node は 20.19.0 以上の 20 系か、22.12.0 以上が要ります (理由は [`docs/library.md`](library.md) の「パッケージの形と動く環境」)。
ソースのファイルの役割は [`docs/architecture.md`](architecture.md) にあります。

### 配る出力とライセンスの表示

`npm run build`・`npm run build:cli`・`npm run build:lib`・`npm run build:browser` の出力 (`dist/`・`dist-cli/`・`dist-lib/`・`dist-browser/`) には、`LICENSE`・`NOTICE`・`THIRD_PARTY_NOTICES.md` が入ります。
出力する JS のファイル (チャンクを含む) の先頭には、Kumiori の版とライセンス、`THIRD_PARTY_NOTICES.md` の場所を書いた注釈 (`/*! … */`) が入ります (CDN からファイルを 1 つだけ読む場合のため)。

## テスト

```bash
npm run typecheck # 型チェック
npm test          # 単体テスト (Node + fontkit。Noto Serif JP を .cache/fonts に取得)
npm run e2e       # ブラウザでの結合テスト (Playwright。初回は npx playwright install chromium)
npm run ci:local  # CI と同じ手順を手元で (下)
```

結合テストの環境変数:

| 変数 | 中身 |
| --- | --- |
| `KUMIORI_E2E_FONT_CACHE` | ディレクトリを指定すると、ブラウザが取った書体をそこに覚えて、次からはネットワークに行かない (CI はこれを使う) |
| `KUMIORI_E2E_FONT_DIR` | 決まった名前の書体を手で用意して使うときの口 |
| `KUMIORI_CHROMIUM` | Chromium の実行ファイルを指すと、Playwright の取った Chromium ではなく、それを使う (Playwright の版と、入っている Chromium の版が合わない環境のため。例: `KUMIORI_CHROMIUM=/opt/pw-browsers/chromium npm run e2e`)。指さないときは Playwright の取った Chromium を使う。比較のスクリプト (`scripts/compare-pdf.mjs`・`scripts/compare-css.mjs`) も同じ |

## CI と同じ手順を手元で (npm run ci:local)

`npm run ci:local` (`scripts/ci-local.mjs`) は、CI (`.github/workflows/ci.yml`) の build と e2e のジョブと、GitHub Pages (`.github/workflows/pages.yml`) の画面のビルドと同じ手順を、手元で順に走らせます。
手順は、npm ci・3 つのビルド・土台を変えた画面のビルド・API の説明書・単体テスト・結合テストです。最後に、手順ごとの結果を並べます。

| 付けるもの | 中身 |
| --- | --- |
| `-- --job build\|pages\|node-min\|e2e` | 走らせるジョブを選ぶ (何度でも書ける)。選ばなければ build・pages・e2e。node-min は、動かせる Node の下限の 20.19.x に切り替えてから走らせる |
| `-- --worktree` | いまのコミット (HEAD) を一時的な場所に取り出して試す (CI と同じく、まだコミットしていない変更や前のビルドの出力が混ざらない) |
| `-- --no-install` | 初めの `npm ci` を飛ばす |

pages のジョブは、`pages.yml` と同じく、アセットの土台 (base) をリポジトリ名 (`package.json` の `repository.url` から取る。`/kumiori/`) にして画面を作ります。
出力の `index.html` のアセットの参照が土台で始まることを確かめ、API の説明書 (`npm run docs:api`) を画面の下の `api/` に作ります。出力は一時的な場所に出して消すので、`dist/` は変わりません。

## テストが取るデータ

| データ | 置き場 (変える変数) | 取得元 | 取る所 |
| --- | --- | --- | --- |
| テストが使う書体 | `.cache/fonts` (`KUMIORI_FONT_DIR`) | Google Fonts (`fonts.gstatic.com`) と、PostScript の書体のテスト用の Source Sans 3 (`raw.githubusercontent.com` の adobe-fonts/source-sans) | `test/helpers.ts` |
| Unicode の公式の適合試験 | `.cache/unicode` (`KUMIORI_UCD_DIR`) | `unicode.org` (`https://www.unicode.org/Public/<版>/ucd/`) | `test/ucdTestData.ts` |

- どちらも初回に取得します。
- テストに書体を足すときは、`test/helpers.ts` の一覧に足します (CI のキャッシュの鍵になります)。
- Unicode の適合試験は、UAX #14 の `LineBreakTest.txt`、UAX #29 の `GraphemeBreakTest.txt`、UAX #9 の `BidiTest.txt`・`BidiCharacterTest.txt` です。版は、`src/unicodeData.ts` の表を作った UCD の版に合わせます。
  取得できない環境では、公式の試験の代わりに、テストの中の手書きの小さな並びだけを確かめます。

## タグ付き PDF の検査 (veraPDF)

タグ付き PDF (`--tagged`・`--pdfua`) は、`node scripts/verapdf.mjs <PDF>...` で、[veraPDF](https://verapdf.org/) (PDF/UA・PDF/A を検査する無償のソフト) の PDF/UA-1 の検査にかけられます。

- PDF ごとに、合うかと、落ちた規則 (規格の節と検査の番号) を出します。`--raw` は veraPDF の報告をそのまま出します (どれかの PDF が合わないか、検査できなければ、終わりの番号は 1)。
- `--flavour` で、ほかの規格の検査も選べます。
- veraPDF は Maven Central (`repo1.maven.org`) から取って `.cache/verapdf` に置きます (`.gitignore` 済み。jar ごとに、スクリプトに書いた SHA-256 と比べます)。
- 動かすには Java が要ります (21 で確かめました)。プロキシを通すときは `NODE_USE_ENV_PROXY=1` を付けます。

## 見本の PDF との比較

比べる見本の FO と PDF は、各自で用意します (リポジトリには入っていません)。poppler の pdftoppm が要ります。

```bash
node scripts/compare-pdf.mjs --fo <FO のディレクトリ> --ref <見本の PDF のディレクトリ> --img <画像のディレクトリ> --out compare-pdf-out
```

- FO と同じ名前の PDF を組にして比べます。`compare-pdf-out/report.md` に、見本ごとのページ数と、ページごとの差 (差の大きい順) が出ます。
- アンテナハウスの見本と比べるときは `--compat antenna` を付けます (既定は仕様どおりのモード)。
- 比較のスクリプトが Playwright の取った Chromium を見つけられないとき (Playwright の版と、入っている Chromium の版が合わないとき) は、結合テストと同じく、`KUMIORI_CHROMIUM` に Chromium の実行ファイルを指します。

### 見本を取る (fetch-samples.mjs)

見本は `scripts/fetch-samples.mjs` で配布元から取って `.cache/samples` に置けます (`.gitignore` 済み。プロキシを通すときは `NODE_USE_ENV_PROXY=1` を付けます)。
アンテナハウスの「サンプル FO 集」(FO と、AH Formatter の出した PDF) と、『CSS ページ組版入門』第 4 版 (PDF と元のファイル) を取り、`manifest.json` に元の URL・大きさ・SHA-256 を書きます。
取ったものは、そのまま compare-pdf.mjs に渡せる形に並べます。

```bash
node scripts/fetch-samples.mjs
node scripts/compare-pdf.mjs --fo .cache/samples/fo/fo --ref .cache/samples/fo/ref --img .cache/samples/fo/img --compat antenna --out compare-pdf-out
```

`.cache/samples/fo/groups.json` に、見本を分類で 4 つに分けた名前の一覧があります (公開している比較ページの分け方)。

`--pack <ディレクトリ>` と `--unpack <ディレクトリ>` で、取ったものを包んで預け、戻せます。

- `--pack` は、取ったもの (zip・PDF と `manifest.json`) を tar にまとめ、10MB ずつに切って base64 の JavaScript に包みます (zip や tar を受け付けない置き場、たとえば claude.ai の Artifact に預けるため)。通常のファイルだけを包みます。
- `--unpack` は、包みの SHA-256 を確かめて戻し、ネットを使わずに展開します (`--offline` と同じ)。
  包みの SHA-256 は同じ置き場の `samples-index.json` と比べるので、分かるのは壊れていないことだけで、出どころではありません。
  なので、展開の前に tar の中身を確かめ、通常のファイルとディレクトリ以外 (シンボリックリンク・ハードリンク・装置ファイルなど) や、絶対パス・`..` を含む名前があれば、何も展開せずに止まります。
  所有者・権限は tar のままにしません (GNU tar の `--no-same-owner`・`--no-same-permissions`)。
- どちらも GNU tar を使います。

### 見本と同じ書体・色で組む

- 見本と同じ書体で組むには、書体のファイルを `--fonts <ディレクトリ>` で渡し、総称の書体 (`serif`・`sans-serif`) に当たる既定の書体を `--web-fonts <ディレクトリ>` で差し替えます。
  MS 明朝・MS ゴシック・Times New Roman・Arial・Courier New を、`notoserif.ttf`・`notosans.ttf`・`tinos400.ttf`・`arimo400.ttf`・`cousine400.ttf` などの名前で置きます。
  TTC は、中の 1 つ目の書体を TTF に取り出します。ディレクトリに無い書体は配信元から取ります。
- 見本が特色 (PDF の Separation の色。『CSS ページ組版入門』第 4 版の PANTONE 627 PC など) で塗っているときは、`node scripts/spot-colors-from-pdf.mjs <見本の PDF> -o spot-colors.json` で、見本の PDF に書かれた特色の名前と濃度 100% の代わりの CMYK を取り出します。
  Node のコマンドに `--spot-colors spot-colors.json` を付けて組み、組んだ PDF を `--pdf` で比べます。
  特色の値は Kumiori に入っていないので、渡さないと代わりの RGB で塗り、色が見本と違います。

### 目で見比べるページ (compare-view.mjs)

見本の PDF と Kumiori の PDF を、同じ名前で組にして、目で見比べるページを作ります。

```bash
node scripts/compare-view.mjs --ref <見本の PDF のディレクトリ> --pdf <Kumiori の PDF のディレクトリ> --out compare-view-out
```

`compare-view-out/index.html` をブラウザで開きます。見本は差の大きい順に並び、ページごとに「並べる」「重ねる」(不透明度を変えられる)・「点滅」・「差」(青は見本にだけ、赤は Kumiori にだけ字や線がある所) を切り替えて見られます。

| 付けるもの | 中身 |
| --- | --- |
| `--inline` | 画像を埋め込んだ HTML 1 つにする |
| `--jpeg` | ページの画像を JPEG にして小さくする |
| `--artifact` | claude.ai の Artifact として公開する形 (差の画像はブラウザで描く) で書き出す |
| `--ref-label`・`--pdf-label` | 左右の呼び名 (既定「見本」「Kumiori」) |
| `--title` | ページの題 |

呼び名と題を変えるのは、見本の無い自作の FO を、Kumiori の 2 つのモードやほかの組版ソフトで組み比べるときです。自作の見本は `samples/check/` にあります。
