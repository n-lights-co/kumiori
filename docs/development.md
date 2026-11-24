> English: [en/development.md](en/development.md)

# 開発とテスト

Kumiori の開発の進め方と、手元での動かし方・テストの方法です。公開の手順は [`docs/RELEASING.md`](RELEASING.md)、版ごとの変更は [`CHANGELOG.md`](../CHANGELOG.md) にあります。

- [開発の方法](#開発の方法)
- [手元で動かす](#手元で動かす)
- [テスト](#テスト)
- [CI と同じ手順を手元で (npm run ci:local)](#ci-と同じ手順を手元で-npm-run-cilocal)
- [読み直しの確かめ](#読み直しの確かめ)
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

Node は 22.12.0 以上が要ります (理由は [`docs/library.md`](library.md) の「パッケージの形と動く環境」)。
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
npm run compare:base -- --base <コミット>  # 前のコミットと組み比べる (「前と後の組み比べ」)
npm run perf:compare -- --base <コミット>  # 前のコミットと組版の時間を比べる (「組版の時間の比べ」)
npm run fingerprints:update            # 領域の木の指紋を書き直す (「領域の木の指紋」)
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
| `-- --job build\|pages\|node-min\|e2e` | 走らせるジョブを選ぶ (何度でも書ける)。選ばなければ build・pages・e2e。node-min は、動かせる Node の下限の 22.12.x に切り替えてから走らせる |
| `-- --worktree` | いまのコミット (HEAD) を一時的な場所に取り出して試す (CI と同じく、まだコミットしていない変更や前のビルドの出力が混ざらない) |
| `-- --no-install` | 初めの `npm ci` を飛ばす |

pages のジョブは、`pages.yml` と同じく、アセットの土台 (base) をリポジトリ名 (`package.json` の `repository.url` から取る。`/kumiori/`) にして画面を作ります。
出力の `index.html` のアセットの参照のうち、絶対のパス (`/` で始まるもの) が土台で始まることを確かめ (相対の参照は、置いた場所から解決されるので見ません)、API の説明書 (`npm run docs:api`) を画面の下の `api/` に作ります。出力は一時的な場所に出して消すので、`dist/` は変わりません。

## Deno・Bun で動くかの確かめ (check-runtimes.mjs)

`node scripts/check-runtimes.mjs` は、配る形 (`npm run build:dist` の出力を `npm pack` した包み) を一時的な場所の新しいプロジェクトに入れ、Node・Deno・Bun のそれぞれで、
API (`kumiori`・`kumiori/node`・`kumiori/browser` の読み込み、HTML・XSL-FO の組版、PDF・SVG・PNG の書き出し、`createTypesetter`、重ねた呼び出しの言語) と、コマンド (PDF・PNG・SVG・標準入力・`--system-fonts`) を走らせ、結果を並べます。
リポジトリの中から読まないのは、Deno がリポジトリの `package.json` を見て依存を探し、利用者の入れ方と違う形になるためです。

| 付けるもの | 中身 |
| --- | --- |
| `--deno <コマンド>`・`--bun <コマンド>` | 実行環境のコマンド (既定は PATH の `deno`・`bun`)。見つからなければ、その環境は飛ばす。入っていなければ、`npm i --prefix <ディレクトリ> deno bun` で npm の包みを取り、`<ディレクトリ>/node_modules/.bin/deno`・`bun` を渡す |
| `--font-dir <ディレクトリ>` | 既定の書体の置き場 (既定は `.cache/fonts`。無い書体は取って置く) |
| `--skip-build` | 初めの `npm run build:dist` を飛ばす |
| `--keep` | 一時的な場所を消さない |

Deno・Bun の版を上げたときや、Node の組み込みのモジュールを新しく使ったとき (`process.getBuiltinModule`・`node:*` の import) に走らせます。

## 読み直しの確かめ

版を出す前の読み直しで、毎回のように見つかった文書の食い違いのうち、機械で見られるものは `npm test` が見ます。

| 試験 | 見るもの |
| --- | --- |
| `test/docsRules.test.ts` | 日英の対 (README・CHANGELOG・SECURITY・docs・examples の説明の、節の並び・表の行の数・コードの塊・箇条書き・表の 1 つ目の欄の名前、対応仕様説明書の塊の要素の並び)・配る文書と src にレビュー台帳の番号が無いこと・配る文書に見えない字 (行の区切りの字 U+2028 など) が無いこと |
| `test/docsTables.test.ts` | `docs/library.md` の選択肢・持ち物の表と公開の型の欄・公開の関数、`docs/diagnostics.md` の args の欄と src で診断を作る所、`docs/cli.md` の環境変数の表とコマンドの読む環境変数 |
| `test/cliDocs.test.ts`・`test/diagnostics.test.ts`・`test/limits.test.ts` | コマンドのオプションの表、診断の名前・重さ・順、入力の上限の表 |

機械で決めにくいものは、読み直しで人が確かめます。

- 変更の記録の「未公開」の節に、前の版から main に入った src の変更の項目があるか (組版の結果が変わる・互換が変わるなどの断りも)。`node scripts/changelog-unreleased.mjs` が、src を変えたのに変更の記録を変えていないコミットと、変更の記録の日英の片方だけを変えたコミットを並べるので、その候補を読みます (前の版を上げたコミットからの範囲。`--since <コミット>` で替えられます)。
- 文の中身が、いまの動きと合うか (直した後の動きに説明が追いついているか)。試験は表の名前と形だけを見ます。

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

## 前と後の組み比べ (compare-base.mjs)

直す前のコミットと後のコミットの Kumiori で、同じ文書を組み比べ、組版の結果の変わった文書とページを一覧にします。
直したい所だけが変わり、ほかの文書が変わっていないことを確かめるために使います。git と poppler (pdfinfo・pdftotext・pdftoppm) が要ります。

```bash
npm run compare:base -- --base <前のコミット>              # 後は HEAD
npm run compare:base -- --base main --head .               # 後は作業の場所のいまのファイル (まだコミットしていない変更を含む)
npm run compare:base -- --base main --only conformance,examples,samples
```

- 2 つのコミットを一時的な場所に取り出して、それぞれで Node のコマンド (`dist-cli`) を作ります。作ったコマンドは `.cache/compare-base/<コミット>/` に置き、次からは作り直しません (`--no-cache` で作り直す)。
  コミットの `package-lock.json` がいまのものと同じなら、このリポジトリの `node_modules` を、その置き場の隣に結んで (リンクにして) 使い、違えば、依存をその置き場に `npm ci` で入れます。
  `--head .` のコマンドは `--out` の `build/` に作り、隣に `node_modules` を結ぶので、`--out` はリポジトリの外でもかまいません。
  `.cache` を別の作業の場所へのリンクにしても、組むときの依存は、走らせた作業の場所のものです (置き場の隣の結びを、走らせるたびに結び直す。同じ置き場を 2 つの作業の場所から同時に使うと、結びを取り合うので避ける)。
- 組む文書は、群ごとに選べます (`--only`・`--skip`。`--filter <文字列>` で、名前にその文字列を含む文書に絞る)。手元に見本が無い群は飛ばし、報告に飛ばした理由を書きます。

| 群 | 文書 |
| --- | --- |
| `conformance` | 対応仕様説明書 4 冊 (`docs/conformance`。`npm run docs:conformance` と同じく、コードの表示を差し込んで組む) |
| `examples` | `examples` の HTML と FO |
| `samples` | `samples` の FO (仕様どおりのモードと `--compat antenna` の両方) と HTML |
| `generated` | 確かめの文書を作る道具で作る文書 (いまは `scripts/gen-column-footnotes.mjs` の段組の脚注の文書 30 個と、`scripts/gen-stress-docs.mjs` の深い入れ子・大きな表・多くの CSS の規則・長い段落・多くの画像などの文書 7 個。後の版の道具で 1 度だけ作り、前と後で同じ文書を組む) |
| `ah` | アンテナハウスのサンプル FO 集 (`--samples` の置き場 (既定 `.cache/samples`) の `fo/samples`。`--compat antenna`) |
| `css-print` | 『CSS ページ組版入門』第 4 版 (`--samples` の置き場の `css-print/src`。`--style ah`。特色の値は `--spot-colors` (既定 `.cache/spot-colors.json`)。無ければ見本の PDF から取り出す) |
| `weasyprint` | WeasyPrint の見本 ([CourtBouillon/weasyprint-samples](https://github.com/CourtBouillon/weasyprint-samples)。`--style weasyprint`。見本の `printall.sh` と同じ組み合わせの 8 つ) |

- WeasyPrint の見本は `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/CourtBouillon/weasyprint-samples <置き場>` で取り、`--weasyprint <置き場>` で渡します (既定は環境変数 `KUMIORI_WEASYPRINT_SAMPLES` か、リポジトリの隣の `weasyprint-samples`)。
  見本の本文と書体は、それぞれのライセンスの他の人の著作物を含むので、リポジトリには入れません。
- リポジトリの文書 (`conformance`・`examples`・`samples`) は、それぞれのコミットのものを組みます (文書を直したコミットなら、その直しも差に出ます)。手元の見本は、前と後で同じファイルを組みます。
- 既定の書体は `.cache/fonts` (テストと同じ置き場) から読みます。`--fonts <ディレクトリ>` (既定は `.cache/ms-fonts` があればそれ) の書体を、`ah`・`css-print` の群に渡し、総称の書体を見本と同じ書体にします。
  前と後を同じ書体で組めば比べられるので、見本と同じ書体が無くても組み比べはできます (報告に、どの書体で組んだかを書きます)。
- PDF の日時は、環境変数 `SOURCE_DATE_EPOCH` で 2000-01-01 にして組みます。日時を渡せない前の版 (日時を組んだ時刻で書き、文書の識別子を乱数で作る版) を組むときだけ、時計と乱数も止めます (`scripts/compare-base-freeze.mjs` を `node --import` で前読みする)。どちらの版も、同じコードで同じ文書を組めば、同じバイトの PDF になります。
  止めた版では `Date.now()` が進まないので、時間の上限 (EPS の `epsMs`・資源の取得の締め切りなど) が効きません。ふだんは時間の上限に当たる文書は、止めた前の版と止めない後の版で、結果や警告が違うことがあります。

比べ方と出力:

- PDF のバイト列が同じ文書は「バイトも同じ」とします。違えば、ページ数、ページごとの字 (`pdftotext -bbox` の語と位置)、絵 (`pdftoppm` で `--dpi` (既定 50) のグレーの画素にし、輝度の差が 32 を超える画素) を比べ、字か絵の変わったページを「変わったページ」とします。
  ページ数・字・絵がどれも同じでバイトの違う文書は「見た目は同じ (バイトは違う)」として分け、報告に一覧を書きます。
  この比べ方では、輝度の近い色 (CMYK・特色・ICC) の変わりや、出力の決まり (OutputIntent)・XMP・タグ付きの構造・注釈・しおりだけの変わりは見えず、「見た目は同じ」に入ります。そうした変更は、`pdfinfo`・veraPDF (`node scripts/verapdf.mjs`) などで別に確かめます。
  警告・誤りの増減と、組版の秒が 1.5 倍を超えて遅くなった文書も書きます。
- `--out` (既定 `compare-base-out`) に `report.md`・`report.json` と、変わったページの、前・後・差を並べた絵 (`images/`。文書ごとに `--max-images` 枚 (既定 20) まで。差は、後にだけある字や線を赤、前にだけあるものを青で描く) を書きます。組んだ PDF は `pdf/base`・`pdf/head` にあります。
- 同時に組む数は `--jobs` (既定は CPU の数) です。全部の群 (文書 270 個) で、4 つの CPU で 6 分ほどです (コマンドを作る時間を除く)。

組版の結果が変わる修正をしたら、直す前のコミットを `--base` にして走らせ、変わった文書とページが、直したかった所だけかを確かめます。
変わった文書とページ (報告の「変わった文書」の表) は、コミットの文に書きます。

## 組版の時間の比べ (perf-compare.mjs)

前のコミットと後のコミットの組版の時間を、同じ機械で交互に測り比べ、後が大きく遅い文書を知らせます (`scripts/perf-compare.mjs`)。

```bash
npm run perf:compare -- --base <前のコミット>               # 後は HEAD
npm run perf:compare -- --base v0.5.0 --head .              # 前のリリースと、作業の場所のいまのファイルを比べる
npm run perf:compare -- --base main --doc fo-spec --rounds 7
```

- 組む文書は、既定で、対応仕様説明書の HTML と XSL-FO (`html-spec`・`fo-spec`) と、種を決めた乱数の文書 (`scripts/gen-stress-docs.mjs`) の表・規則・段落・XSL-FO の入れ子です (`--doc` で選ぶ。名前は `scripts/profile-relayout.mjs` の `--doc` と同じ)。
  どちらのコミットでも、作業の場所の文書と書体を組みます (組版のコードだけを比べる)。
- 機械の揺れは、次のように扱います。
  - 測るのは、組むスレッドの CPU の時間です (ほかのプロセスに CPU を取られて待った時間と、GC のほかのスレッドの時間が入らない)。壁の時計の時間も並べて書きます。
  - 前と後を、組ごとに順を入れ替えて交互に測ります (`--rounds` 組。既定 5)。1 つの組では、文書ごとに `--runs` 回 (既定 3) 組み、温まった回の一番短い値を取ります。
  - 組ごとの比 (後 ÷ 前) の中央値が `--threshold` (既定 1.1) を超え、組の 8 割以上で後のほうが遅いときに「遅い」とし、終わりの状態を 1 にします (`--no-fail` で 0)。
- 既定の文書と回数で、4 つの CPU の機械で 15 分ほどかかります (1 組の片方で 90 秒ほど)。`--json <ファイル>` で結果を JSON でも書きます。
- `npm run compare:base` は、多くの文書を 1 度ずつ並べて組み、組版の秒が 1.5 倍を超えた文書を報告に書きます (粗い見張り)。この道具は、主な数個の文書で 1 割ほどの違いを見分けます (細かい確かめ)。
  `compare:base` の報告に遅くなった文書が出たときと、組版の手間を変える変更 (組み直しの回・止める合図の確かめなど) の後と、リリースの前 (前のリリースのタグと比べる) に走らせます。

### 時間を確かめる試験

`npm test` の中で時間を確かめる試験は、機械の速さと負荷 (ほかの試験のワーカー・ビルド) に揺れないように、`test/timing.ts` の道具で測ります。

- 時間は、壁の時計でなく、試験のスレッドの CPU の時間で測ります (`cpuClock`)。上限は `scaled(ミリ秒)` で書き、遅い機械では環境変数 `KUMIORI_TIME_SCALE` (既定 1) で何倍かにできます。
- 手間の伸び方は、大きさ n と 4n を交互に測り、一番短い値どうしの比で見ます (`expectGrowth`。線形なら 4、2 乗なら 16 なので、上限は 8)。
  悪い入力は、同じ量のふつうの入力と交互に測った比で縛ります (`expectRatio`)。どちらも、上限の内に入るまで 3 組まで測り直します。
- 悪い入力 (小さな入力で時間を使い切らせるもの) の試験は `test/hostileInputs.test.ts` に集めています。まだ直していない入力は `it.skip` にしてあり、直したら skip を外します。
- 種を決めた乱数の文書の指標 (ページ数・数行だけのページの数・警告) と伸び方は `test/stressDocs.test.ts` (段組の脚注の文書は `test/columnFootnoteReserve.test.ts`) で確かめます。
  大きな版は `node scripts/gen-stress-docs.mjs <ディレクトリ>` で書き出せ、`compare:base` の `generated` の群でも組みます。

## メモリの山の測り (measure-memory.mjs)

PDF を作るときのメモリの山を、`typesetToPdf` と、流して書く `typesetToPdfStream` (書き出し先は `fs.writeSync`) で、メモリ節約 (`lowMemory`) の有り無しで測ります (`scripts/measure-memory.mjs`)。
PDF の書き出しやメモリ節約を変えたときに、山が上がっていないかを見ます。

```bash
node scripts/measure-memory.mjs                                  # 既定の文書を 4 つの形で
node scripts/measure-memory.mjs --doc images:200 --mode pdf --mode stream
node scripts/measure-memory.mjs --doc text:11200 --json mem.json  # 文だけの 1,600 ページの文書
```

- 文書は、対応仕様説明書の HTML と XSL-FO (`html-spec`・`fo-spec`)、文だけの文書 (`text[:節の数]`。作る)、画像の多い文書 (`images[:枚数]`。圧縮の効かない 600×600 の PNG を作る)、
  手元にあれば『CSSページ組版入門』第 4 版 (`css-print`) です。形は `pdf`・`stream`・`pdf-low`・`stream-low` です。
- 文書と形ごとに新しい Node のプロセス (`--expose-gc`) で組み、20ms ごとと進み具合の呼び返しのたびに `process.memoryUsage()` を見ます。表には、ヒープ・外のバイト列 (`arrayBuffers`)・RSS の山と、
  PDF を書く間の生きている量 (片付けてから見た量) を書きます。ヒープの山は片付けの時機で揺れるので、流すか流さないかの比べには、生きている量を使います。
  JSON には、進み具合の段 (`resources`・`import`・`layout`・`pdf`) ごとの外のバイト列の山も書きます。`--no-build` で、前に作ったビルド (`.cache/measure-memory-build`) を使います。
- 画像の多い文書は、道具が作った画像のバイト列を、組む間ずっと持っています (外のバイト列の初めの量に入ります)。

## 先頭から N ページの組版の確かめ (check-max-pages.mjs)

先頭から N ページで止めて組んだ 1〜N ページ (`--max-pages N`・API の `maxPages`) が、全体を組んだときの 1〜N ページと同じかを、文書ごとに数えます。
組版の本体 (改ページ・脚注・段組・組み直しの回) を直したときに、止めた組版がずれないことを確かめるために使います。poppler (pdfinfo・pdftotext・pdftoppm) が要ります。

```bash
node scripts/check-max-pages.mjs                         # N は 1・3・10。手元にある見本の群をすべて組む
node scripts/check-max-pages.mjs --only weasyprint,conformance --pages 2,5
```

- 群は `ah` (アンテナハウスのサンプル FO 集)・`css-print` (『CSS ページ組版入門』第 4 版)・`weasyprint` (WeasyPrint の見本)・`conformance` (対応仕様説明書の HTML と XSL-FO) です。
  見本の置き場は、前と後の組み比べと同じです (`--samples`・`--weasyprint`)。コマンドは `dist-cli` を使い、無ければ `npm run build:cli` で作ります。時計と乱数は止めて組みます。
- ページごとに、字 (`pdftotext -bbox` の語と位置) と絵 (`pdftoppm` で `--dpi` (既定 40) のグレーの画素) を比べ、違うページを次のどれかに分けます。
  - 参照の字だけ: 行の並びが同じで、数字・`"?"`・リーダーの点を除けば語の並びも同じ (N より後ろを指す参照が `"?"` になった)
  - 行分けまで変わった: 行の並びか、ほかの語が違う
  - 絵だけ違う: 字は同じで、絵だけ違う
- N より後ろを指す参照の警告 (`layout/beyond-max-pages`) が出なかったのに違うページは「警告が無いのに違うページ」として数えます。0 でなければ、組版の作りの誤りを疑います。
- `--out` (既定 `.cache/check-max-pages`) に `report.md`・`report.json` を書きます。

## 使い回しの有無の組み比べ (check-relayout.mjs)

器 (`createTypesetter`) が前の文書の組版の覚えを使い回して組んだ結果が、使い回さないとき (`reuse: false`) と同じかを確かめます。
文書を、種を決めた乱数の所で少しずつ直し (字を足す・消す・置き換える。タグと文字参照は壊さない。ときどき、ブロックに組み方の属性を足す直しと、ページのマスター (XSL-FO の領域・HTML の `@page`) に背景の色を足すだけの直しもする)、「元の文書・直したもの (`--edits` 個。重ねて直す)・元の文書に戻したもの」を、
使い回す器と使い回さない器で順に組んで、領域の木・診断 (場所の行と桁まで)・警告・PDF のバイト列 (時計と乱数は止める) を比べます。違えば、使い回しの側の誤りです。
器の使い回しや、途中から組み直す作りを直したときに使います (部品は `scripts/relayout-check-lib.mjs`。比べる器と、組んだ結果から報告に出す数を足せる形にしてあります)。

```bash
node scripts/check-relayout.mjs --jobs 4                          # 手元にある群をすべて組む
node scripts/check-relayout.mjs --only conformance,css-print --seed 2 --edits 5
```

- 群は `conformance` (対応仕様説明書の日本語と英語)・`examples`・`samples`・`generated` (`scripts/gen-stress-docs.mjs` の文書)・`ah`・`css-print`・`weasyprint` です。
  見本の置き場は、前と後の組み比べと同じです (`--samples`・`--weasyprint`)。書体は既定の書体で組みます。
- 文書ごとに 1 行 (版の数・ページ数・使い回した段落の数・時間) を出し、違った版は、どこが違うか (領域の木は最初に違うページ、PDF は最初に違うバイト) を出します。
  違う版があれば、終わりの状態が 1 になります。`--json` で結果を書きます。
- `--skip` で群を除き、`--no-pdf` で PDF のバイト列を比べずに速く回します。`--src`・`--no-build` は `scripts/profile-relayout.mjs` と同じです (組版のソースの場所・前に作ったビルドを使う)。
- 小さな文書の速い版は `test/relayoutCheck.test.ts` で、`npm test` に入っています。

### 続きから組む作りの確かめ (check-resume.mjs)

組版は、1 段の page-sequence を、ページの境目で止めて、写した状態から続きを組めます (最後のページのマスターを選び直すとき、続きから組める境目から組み直します)。
`scripts/check-resume.mjs` は、続きから組める境目のすべてで、1 ページ先まで組んでから境目に戻り、写した状態から続けて組む器 (`--subjects resume`) で組み、
使い回さない器で組んだものと、上と同じものを比べます。戻って同じ境目に来たときの、境目の指紋も比べます。続きから組む作りを直したときに使います。

```bash
node scripts/check-resume.mjs --jobs 4                            # 手元にある群をすべて組む (check-relayout.mjs を --subjects resume --edits 0 で走らせる)
node scripts/check-resume.mjs --only ah --filter keep             # 群・名前で絞る (引数は check-relayout.mjs と同じ)
node scripts/check-resume.mjs --late 4 --jobs 4                   # 遅く戻る試し (下)
```

- `--late N` は、page-sequence を終わりまで組んだ後、続きから組める境目を N 個ほど散らして選び、後ろから順に、境目に戻って終わりまで組み直す器
  (`--subjects resume-late`) で試します。組版の中で境目から組み直す使い方 (最後のページのマスター) と同じ形で、境目の 1 ページより後で、
  写しと共有の物を書き換える誤りを探します。組み直すたびに、その組み直しの流れが写した次の境目からも、もう 1 度終わりまで組み直します
  (続けた流れが写す境目の誤りは、1 度続けただけでは結果に出ず、その境目から続けたときに出るため)。
- `generated` の群には、左右 (HTML の `@page :left`)・奇数偶数のマスターで本文の幅が違い、ページをまたぐ長い段落の続く文書 (`generated/sidewidth`・`generated/fosidewidth`) も入ります。
  段落の途中の境目から続けると、行の長さの変わるページで残りの行を組み直すので、その間に写す境目の誤りを探せます。

- 文書ごとの行に、写した境目・続きから組めた境目・続けた回数と、続きから組めない境目の理由ごとの数 (`site:children/child:<種類>` は続きから組めない子のブロックの中 (`block-container-columns` は段組のブロックコンテナ)、
  `site:inline` は回り込みのある行の並びの中、など) を出します。
- 小さな文書の速い版は `test/resume.test.ts` で、`npm test` に入っています。

## 領域の木の指紋 (npm run fingerprints:update)

主な文書の領域の木の指紋を `test/fingerprints/` に置いていて、組版の結果が変わると `npm test` が落ちます (`test/fingerprint.ts`)。

- 指紋は、`serializeAreaTree` と同じ JSON の SHA-256 です。数は 1/1000 pt に丸め、画像のデータなどのバイトの並びは、その SHA-256 にしてから計ります。文書の全体の指紋と、ページごとの指紋を持ち、落ちたときは、変わったページの番号を出します。
- 比べる文書: 対応仕様説明書 4 冊の、見本の 1 つずつと文書の全体 (`test/conformance.test.ts`。`test/fingerprints/conformance.json`)、`examples/drawio-pages` の文書と、`samples/check` の FO の 2 つのモード (`test/fingerprints.test.ts`。`test/fingerprints/documents.json`)。
- 書体は既定の書体を `.cache/fonts` から読みます (置いてあればネットワークを使いません)。指紋を計る分の時間は、合わせて数秒です (`test/fingerprints.test.ts` は 3 秒ほど。対応仕様説明書の試験は、もともと全部の見本を組んでいて、指紋を足しても 2 分半ほどのまま)。

意図して組版の結果を変えたときは、指紋を書き直します。

```bash
npm run compare:base -- --base <直す前のコミット> --head .   # どの文書のどのページが変わったかを確かめる
npm run fingerprints:update                                  # 指紋を書き直す (指紋の試験を、比べずに、いまの指紋を書く形で走らせる)
git diff --stat test/fingerprints                            # 書き直した指紋の文書を見る
```

`npm run fingerprints:update -- -t <試験の名前>` のように絞ると、組んだ文書の指紋だけを書き直し、組まなかった文書の指紋はファイルにあるものを残します (警告で落ちて指紋を計れなかった文書も、前の指紋のまま残す)。
ファイルから消すのは、もう組まない文書 (試験の一覧に無い文書) の指紋だけです。

指紋を書き直したコミットの文には、指紋の変わった文書 (試験の失敗の文か `git diff` で分かる) と、変わった理由 (何を直して、どのページの何が変わったか。前と後の組み比べの結果) を書きます。
意図していない文書の指紋が変わったら、書き直さずに、その変わりが正しいかを確かめます。
