> English: [en/development.md](en/development.md)

# 開発とテスト

Kumiori の開発の進め方と、手元での動かし方・テストの方法です。公開の手順は [`docs/RELEASING.md`](RELEASING.md)、バージョンごとの変更は [`CHANGELOG.md`](../CHANGELOG.md) にあります。

- [開発の方法](#開発の方法)
- [手元で動かす](#手元で動かす)
- [テスト](#テスト)
- [CI と同じ手順を手元で (npm run ci:local)](#ci-と同じ手順を手元で-npm-run-cilocal)
- [読み直しの確認](#読み直しの確認)
- [テストが取得するデータ](#テストが取得するデータ)
- [タグ付き PDF の検査 (veraPDF)](#タグ付き-pdf-の検査-verapdf)
- [出来た PDF の検査 (check-pdfs.mjs)](#出来た-pdf-の検査-check-pdfsmjs)
- [確認の時間](#確認の時間)
- [サンプルの PDF との比較](#サンプルの-pdf-との比較)

## 開発の方法

Kumiori は、AI のコーディング支援 (Anthropic の [Claude Code](https://claude.com/claude-code)) を使って開発しています。

- コード・テスト・ドキュメントの多くは、AI が書いたものです。何を作るか、どの仕様にどう従うかは人が決めます。
- 組版の結果は人が確認し、直す点を指示し、レビューしたうえで取り込んでいます。
- 仕様の解釈は、仕様書を読み、公開されているサンプルの PDF と組んだ結果を見比べて確認しています。
- 機能を追加するたびにテストを書き足し、型チェック・単体テスト・ブラウザーでの結合テストを通しています。
- 第三者のコードやライセンスの混入は、公開前にツールで点検しています ([THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md))。

### 根拠にしている規格・仕様書

XSL-FO 1.1、CSS の各モジュール (Paged Media・GCPM・Writing Modes・Text・Ruby・Fragmentation など)、MathML Core、Unicode の UAX #9 (双方向) と UAX #14 (改行)、W3C の JLREQ (日本語組版処理の要件。JIS X 4051 に基づく)、PDF (ISO 32000) などの規格・仕様書を可能な限り読み、その定義に沿って実装しています。
約物の詰め・ぶら下げ・ルビのはみ出しなど、日本語組版の細部も規格に基づいています。
プロパティごとの対応状況と、仕様の定義・Kumiori での扱いは、対応仕様説明書 ([`docs/conformance/`](conformance/README.md)) にまとめています。

XSL-FO や CSS の組版ソフトが公開しているサンプルの PDF と、Kumiori で組んだ結果を見比べて、仕様の解釈や細かな組み方を確認しています ([サンプルの PDF との比較](#サンプルの-pdf-との比較))。

## 手元で動かす

```bash
npm install
npm run dev          # http://localhost:5173  (プレビュー + 「PDF を保存」)
npm run build        # 型チェック + 本番ビルド (dist/。画面)
npm run build:dist   # ライブラリ (dist-lib)・Node のコマンド (dist-cli)・ブラウザー用の 1 ファイル (dist-browser) をまとめて作る
npm run docs:api     # API リファレンス (dist/api/)
```

Node は 22.12.0 以上が要ります (理由は [`docs/library.md`](library.md) の「パッケージの形と動作環境」)。
ソースのファイルの役割は [`docs/architecture.md`](architecture.md) にあります。

### 配る出力とライセンスの表示

`npm run build`・`npm run build:cli`・`npm run build:lib`・`npm run build:browser` の出力 (`dist/`・`dist-cli/`・`dist-lib/`・`dist-browser/`) には、`LICENSE`・`NOTICE`・`THIRD_PARTY_NOTICES.md` が入ります。
出力する JS のファイル (チャンクを含む) の先頭には、Kumiori のバージョンとライセンス、`THIRD_PARTY_NOTICES.md` の場所を書いた注釈 (`/*! … */`) が入ります (CDN からファイルを 1 つだけ読む場合のため)。

## テスト

```bash
npm run typecheck # 型チェック
npm test          # 単体テスト (Node + fontkit。Noto Serif JP を .cache/fonts に取得)
npm run e2e       # ブラウザーでの結合テスト (Playwright。初回は npx playwright install chromium)
npm run ci:local  # CI と同じ手順を手元で (下)
npm run compare:base -- --base <コミット>  # 前のコミットと組み比べる (「前と後の組み比べ」)
npm run perf:compare -- --base <コミット>  # 前のコミットと組版の時間を比べる (「組版の時間の比べ」)
npm run fingerprints:update            # エリアツリーのフィンガープリントを書き直す (「エリアツリーのフィンガープリント」)
```

結合テストの環境変数:

| 変数 | 中身 |
| --- | --- |
| `KUMIORI_E2E_FONT_CACHE` | ディレクトリを指定すると、ブラウザーが取得したフォントをそこにキャッシュして、次からはネットワークに行かない (CI はこれを使う) |
| `KUMIORI_E2E_FONT_DIR` | 決まった名前のフォントを手で用意して使うときの口 |
| `KUMIORI_CHROMIUM` | Chromium の実行ファイルを指すと、Playwright の取得した Chromium ではなく、それを使う (Playwright のバージョンと、入っている Chromium のバージョンが合わない環境のため。例: `KUMIORI_CHROMIUM=/opt/pw-browsers/chromium npm run e2e`)。指さないときは Playwright の取得した Chromium を使う。比較のスクリプト (`scripts/compare-pdf.mjs`・`scripts/compare-css.mjs`) も同じ |

## CI と同じ手順を手元で (npm run ci:local)

`npm run ci:local` (`scripts/ci-local.mjs`) は、CI (`.github/workflows/ci.yml`) の build・e2e・relayout・compare・pdf のジョブと、GitHub Pages (`.github/workflows/pages.yml`) の画面のビルドと同じ手順を、手元で順に走らせます。
手順は、npm ci・3 つのビルド・土台を変えた画面のビルド・API リファレンス・単体テスト・結合テスト・組み直しの再利用の確認・意図した変化の一覧と比較する組み比べ・出来た PDF の検査です。最後に、手順ごとの結果を並べます。

| 付けるもの | 中身 |
| --- | --- |
| `-- --job build\|pages\|node-min\|e2e\|relayout\|compare\|pdf` | 走らせるジョブを選ぶ (何度でも書ける)。選ばなければ node-min のほかの全部。node-min は、動かせる Node の下限の 22.12.x に切り替えてから走らせる |
| `-- --worktree` | いまのコミット (HEAD) を一時的な場所に取り出して試す (CI と同じく、まだコミットしていない変更や前のビルドの出力が混ざらない) |
| `-- --no-install` | 初めの `npm ci` を飛ばす |

pages のジョブは、`pages.yml` と同じく、アセットの土台 (base) をリポジトリ名 (`package.json` の `repository.url` から取得する。`/kumiori/`) にして画面を作ります。
出力の `index.html` のアセットの参照のうち、絶対のパス (`/` で始まるもの) が土台で始まることを確認 (相対の参照は、置いた場所から解決されるので見ません)、API リファレンス (`npm run docs:api`) を画面の下の `api/` に作ります。出力は一時的な場所に出して消すので、`dist/` は変わりません。

relayout のジョブは、組み直しの再利用の確認を、リポジトリの文書の全部 (群 `conformance`・`examples`・`samples`・`generated`) で走らせます:
`createTypesetter` の再利用と前の組版と連結する所 (`scripts/check-relayout.mjs --subjects reuse,splice-verify`)、途中から再開する作り (`scripts/check-resume.mjs`)、遅く戻る試し (`scripts/check-resume.mjs --late 4`) です (「再利用の有無の組み比べ」)。
初めから再利用せずに組んだ結果と違えば落ちます。代表の文書での速い組は `npm test` (`test/relayoutAlways.test.ts`・`test/relayoutCheck.test.ts`・`test/resume.test.ts`・`test/relayoutSplice.test.ts`) に入っています。

compare のジョブは、意図した変化の一覧 (`test/intended-changes.json`) を空にした、いちばん新しいコミットと組み比べ (`scripts/compare-base.mjs --intended`)、一覧に無い文書・ページの変化があれば落ちます (「意図した変化の一覧」)。
リポジトリの文書の全部を組みます。前のコミットを取り出すので、git の履歴 (浅く取り出したリポジトリなら、一覧を空にしたコミットまで) と poppler が要ります。

pdf のジョブは、リポジトリの文書 (群 `conformance`・`examples`・`samples`) を PDF/UA-1・PDF/A・PDF/X で組み、出来た PDF を qpdf・Poppler・veraPDF で検査します (`scripts/check-pdfs.mjs`。「出来た PDF の検査 (check-pdfs.mjs)」)。
qpdf・poppler・Java が要ります。veraPDF は、`.cache/verapdf` (`--worktree` でも、このリポジトリのもの) に無ければ取得します。

## Deno・Bun で動くかの確認 (check-runtimes.mjs)

`node scripts/check-runtimes.mjs` は、配る形 (`npm run build:dist` の出力を `npm pack` したパッケージ) を一時的な場所の新しいプロジェクトに入れ、Node・Deno・Bun のそれぞれで、
API (`kumiori`・`kumiori/node`・`kumiori/browser` の読み込み、HTML・XSL-FO の組版、PDF・SVG・PNG の書き出し、`createTypesetter`、重ねた呼び出しの言語) と、コマンド (PDF・PNG・SVG・標準入力・`--system-fonts`) を走らせ、結果を並べます。
リポジトリの中から読まないのは、Deno がリポジトリの `package.json` を見て依存を探し、利用者の入れ方と違う形になるためです。

| 付けるもの | 中身 |
| --- | --- |
| `--deno <コマンド>`・`--bun <コマンド>` | 実行環境のコマンド (既定は PATH の `deno`・`bun`)。見つからなければ、その環境は飛ばす。入っていなければ、`npm i --prefix <ディレクトリ> deno bun` で npm のパッケージを取得し、`<ディレクトリ>/node_modules/.bin/deno`・`bun` を渡す |
| `--font-dir <ディレクトリ>` | 既定のフォントのディレクトリ (既定は `.cache/fonts`。無いフォントは取得して置く) |
| `--skip-build` | 初めの `npm run build:dist` を飛ばす |
| `--keep` | 一時的な場所を消さない |

Deno・Bun のバージョンを上げたときや、Node の組み込みのモジュールを新しく使ったとき (`process.getBuiltinModule`・`node:*` の import) に走らせます。

## 読み直しの確認

バージョンを出す前の読み直しで、毎回のように見つかった文書の食い違いのうち、機械で見られるものは `npm test` が見ます。

| 試験 | 見るもの |
| --- | --- |
| `test/docsRules.test.ts` | 日英の対 (README・CHANGELOG・SECURITY・docs・examples の説明の、節の並び・表の行の数・コードの塊・箇条書き・表の 1 つ目の列の名前、対応仕様説明書の塊の要素の並び)・配る文書と src にレビュー台帳の番号が無いこと・配る文書に見えない文字 (行の区切りの文字 U+2028 など) が無いこと |
| `test/docsTables.test.ts` | `docs/library.md` のオプション・持ち物の表と公開の型の列・公開の関数、`docs/diagnostics.md` の args のフィールドと src で診断を作る所、`docs/cli.md` の環境変数の表とコマンドの読む環境変数 |
| `test/cliDocs.test.ts`・`test/diagnostics.test.ts`・`test/limits.test.ts` | コマンドのオプションの表、診断の名前・重大度・順、入力の上限の表 |

機械で決めにくいものは、読み直しで人が確認します。

- 変更履歴の「未公開」の節に、前のバージョンから main に入った src の変更の項目があるか (組版の結果が変わる・互換が変わるなどの注意も)。`node scripts/changelog-unreleased.mjs` が、src を変えたのに変更履歴を変えていないコミットと、変更履歴の日英の片方だけを変えたコミットを並べるので、その候補を読みます (前のバージョンを上げたコミットからの範囲。`--since <コミット>` で替えられます)。
- 文の中身が、いまの動きと合うか (直した後の動きに説明が追いついているか)。試験は表の名前と形だけを見ます。

## テストが取得するデータ

| データ | 格納先 (変える変数) | 取得元 | 取得する所 |
| --- | --- | --- | --- |
| テストが使うフォント | `.cache/fonts` (`KUMIORI_FONT_DIR`) | Google Fonts (`fonts.gstatic.com`) と、PostScript のフォントのテスト用の Source Sans 3 (`raw.githubusercontent.com` の adobe-fonts/source-sans) | `test/helpers.ts` |
| Unicode の公式の適合試験 | `.cache/unicode` (`KUMIORI_UCD_DIR`) | `unicode.org` (`https://www.unicode.org/Public/<版>/ucd/`) | `test/ucdTestData.ts` |

- どちらも初回に取得します。
- テストにフォントを追加するときは、`test/helpers.ts` の一覧に追加します (CI のキャッシュのキーになります)。
- Unicode の適合試験は、UAX #14 の `LineBreakTest.txt`、UAX #29 の `GraphemeBreakTest.txt`、UAX #9 の `BidiTest.txt`・`BidiCharacterTest.txt` です。バージョンは、`src/unicodeData.ts` の表を作った UCD のバージョンに合わせます。
  取得できない環境では、公式の試験の代わりに、テストの中の手書きの小さな並びだけを確認します。

## タグ付き PDF の検査 (veraPDF)

タグ付き PDF (`--tagged`・`--pdfua`) は、`node scripts/verapdf.mjs <PDF>...` で、[veraPDF](https://verapdf.org/) (PDF/UA・PDF/A を検査する無償のソフト) の PDF/UA-1 の検査にかけられます。

- PDF ごとに、合うかと、落ちた規則 (規格の節と検査の番号) を出します。`--raw` は veraPDF の報告をそのまま出します (どれかの PDF が合わないか、検査できなければ、終わりの番号は 1)。
- `--flavour` で、ほかの規格の検査も選べます。
- veraPDF は Maven Central (`repo1.maven.org`) から取得して `.cache/verapdf` に置きます (`.gitignore` 済み。jar ごとに、スクリプトに書いた SHA-256 と比べます)。
- 動かすには Java が要ります (21 で確認しました)。プロキシを通すときは `NODE_USE_ENV_PROXY=1` を付けます。
- 取得の仕方と動かし方のモジュールは `scripts/verapdf-lib.mjs` にあります (出来た PDF の検査 `scripts/check-pdfs.mjs` も使います)。

## 出来た PDF の検査 (check-pdfs.mjs)

`node scripts/check-pdfs.mjs` は、文書を PDF の出力の設定ごとに組み、出来た PDF を検査します (`npm run ci:local` の pdf のジョブ。モジュールは `scripts/pdf-checks-lib.mjs`)。

- 組み方: PDF/UA-1 (`pdfua`)・PDF/A-2b (`pdfa-2b`)・PDF/A-3b と PDF/UA-1 (`pdfa-3b-ua`)・PDF/X-4 (`pdfx-4`。CMYK の出力の ICC プロファイルは試験で作るもの `test/iccTestProfile.ts`)・PDF/X-1a (`pdfx-1a`)。
  対応仕様説明書 4 冊は `pdfua`・`pdfa-2b`・`pdfx-4`、examples と samples の文書はすべての組み方、外のサンプルは `pdfua` だけで組みます。
- 形の検査 (壊れた PDF を見つける): `qpdf --check` (エラーも警告も落とす)、Poppler の `pdfinfo` (読めるか・ページ数・タグ付きか)・`pdffonts` (フォントがどれも埋め込まれているか)・`pdftotext` (ページの中身の流れを読めるか)。
  Poppler は、読めても標準エラーに構文のエラー (`Syntax Error` など) を出すことがあるので、その行も落とします。
- veraPDF の検査: PDF/UA-1 (`ua1`)・PDF/A-2b (`2b`)・PDF/A-3b (`3b`) の落ちた規則 (規格の節と検査の番号。「7.1-3」の形) を、基準 (`test/pdf-checks.json`) と比べます。
  基準に無い規則が落ちたら落とします。基準にあって落ちなくなった規則は、落とさずに通知します (`--update` で基準を書き直す)。PDF/X は veraPDF に検査の規則が無いので、形の検査だけをします。
- いまの基準で落ちてよい規則は、文書の中身によるものだけです (図の代替テキストの無い図 7.3-1、タイトルの無い文書 7.1-9、数式の代替テキスト 7.7-1、見出しの段が飛ぶ所 7.4.2-1。どれも PDF/UA-1)。PDF/A-2b・PDF/A-3b と形の検査は、どの文書も通ります。

| 付けるもの | 中身 |
| --- | --- |
| `--only <群>,…`・`--skip <群>,…` | 組む文書の群 (既定 `conformance,examples,samples`。名前は `scripts/check-relayout.mjs` と同じ。文書の一覧は `scripts/doc-sources.mjs`) |
| `--filter <文字列>` | 名前にその文字列を含む文書だけを組む |
| `--jobs <数>` | 文書を組むプロセスの数 (既定は CPU の数と、メモリ 5GB に 1 つの小さい方)。重い文書から先に組みます |
| `--baseline <JSON>`・`--update` | veraPDF の基準のファイル (既定 `test/pdf-checks.json`) と、組んだ文書の基準の書き直し |
| `--out <ディレクトリ>`・`--keep` | PDF を書く場所 (既定は一時の場所で、終われば消す) と、消さずに残す指定 |

- `npm test` の `test/pdfChecks.test.ts` は、小さなリポジトリの文書 2 つ (`examples/drawio-pages/pages.html`・`samples/check/fo/indent-inheritance-1.fo`) をすべての組み方で組み、同じ検査をします (同じ基準のファイル)。
  qpdf・Poppler・Java と `.cache/verapdf` の veraPDF (環境変数 `KUMIORI_VERAPDF_DIR` があればそこ) が無ければ、その検査を飛ばします (失敗にしません。veraPDF は取得しに行きません)。
- ツールの入れ方: Debian・Ubuntu なら `sudo apt-get install -y qpdf poppler-utils`。veraPDF は `NODE_USE_ENV_PROXY=1 node scripts/verapdf.mjs --fetch-only` (プロキシを通さないなら `NODE_USE_ENV_PROXY=1` は要りません)。

## 確認の時間

4 つの CPU・メモリ 16GB (使えるのは 14GB ほど) の機械で測った、確認の手順ごとの時間です (秒。0.8.0 の初めに、確認を速くしたときの前と後)。

| 手順 | 前 | 後 | 変えたこと |
| --- | --- | --- | --- |
| `npm test` | 713 | 628 | 同時に走らせるファイルを CPU の数にし (vitest の既定は CPU の数 − 1)、時間のかかるファイルから先に走らせ、対応仕様説明書の試験を日本語版と英語版の 2 つのファイルに分け、コマンドのシグナルの試験の 2 つのシグナルを並べた |
| `npm run e2e` | 136 | 77 | ファイルの中の試験も並べ、ワーカーを CPU の数にした (Playwright の既定は CPU の数の半分で、ファイルの中は 1 つずつ) |
| relayout: `check-relayout` | 558 | 487 | 空いたプロセスに重い文書から渡し、メモリの見積もりで重い文書の重なりを抑えて、同時に組む数を CPU の数にした (前は 3) |
| relayout: `check-resume` | 109 | 85 | 同じ |
| relayout: `check-resume --late 4` | 140 | 111 | 同じ |
| pdf: `check-pdfs` | — | 139 | 新しい手順 (「出来た PDF の検査 (check-pdfs.mjs)」) |

- `npm test` の前は、前の走りのキャッシュ (`node_modules/.vite` の中) のある走りです。キャッシュの無い走り (`npm ci` の直後・`npm run ci:local -- --worktree`) では、前は、小さなファイルの重い試験 (対応仕様説明書を組む `test/conformance.test.ts`) が後に回って、終わりの数分をそのファイルだけが走っていました。後の 628 秒は、キャッシュの無い走りです。
- 時間のかかるファイルの順は、前の走りのキャッシュが無ければ `test/durations.json` (主なファイルの測った秒) で見積もります (`test/sequencer.ts`)。試験のファイルを追加したり、重さが大きく変わったりしたら、`npx vitest run --reporter=default --reporter=json --outputFile.json=<報告.json>` の後に `node scripts/test-durations.mjs <報告.json>` で書き直します。古くなっても、試験の結果は変わりません (順が悪くなるだけ)。
- 確認する中身 (試験・文書・組み方) は減らしていません。
- `check-relayout` は、対応仕様説明書の HTML と CSS 編の英語版 1 冊で 340 秒ほどかかり、全体はその 1 冊と、ほかの文書の合計 (CPU の時間で 1500 秒ほど) を 4 つで割ったものの大きい方で決まります。

## サンプルの PDF との比較

比べるサンプルの FO と PDF は、各自で用意します (リポジトリには入っていません)。poppler の pdftoppm が要ります。

```bash
node scripts/compare-pdf.mjs --fo <FO のディレクトリ> --ref <サンプルの PDF のディレクトリ> --img <画像のディレクトリ> --out compare-pdf-out
```

- FO と同じ名前の PDF を組にして比べます。`compare-pdf-out/report.md` に、サンプルごとのページ数と、ページごとの差 (差の大きい順) が出ます。
- アンテナハウスのサンプルと比べるときは `--compat antenna` を付けます (既定は仕様どおりのモード)。
- 比較のスクリプトが Playwright の取得した Chromium を見つけられないとき (Playwright のバージョンと、入っている Chromium のバージョンが合わないとき) は、結合テストと同じく、`KUMIORI_CHROMIUM` に Chromium の実行ファイルを指します。

### サンプルを取得する (fetch-samples.mjs)

サンプルは `scripts/fetch-samples.mjs` で配布元から取得して `.cache/samples` に置けます (`.gitignore` 済み。プロキシを通すときは `NODE_USE_ENV_PROXY=1` を付けます)。
アンテナハウスの「サンプル FO 集」(FO と、AH Formatter の出した PDF) と、『CSS ページ組版入門』第 4 版 (PDF と元のファイル) を取得し、`manifest.json` に元の URL・大きさ・SHA-256 を書きます。
取得したものは、そのまま compare-pdf.mjs に渡せる形に並べます。

```bash
node scripts/fetch-samples.mjs
node scripts/compare-pdf.mjs --fo .cache/samples/fo/fo --ref .cache/samples/fo/ref --img .cache/samples/fo/img --compat antenna --out compare-pdf-out
```

`.cache/samples/fo/groups.json` に、サンプルを分類で 4 つに分けた名前の一覧があります (公開している比較ページの分け方)。

`--pack <ディレクトリ>` と `--unpack <ディレクトリ>` で、取得したものを包んで預け、戻せます。

- `--pack` は、取得したもの (zip・PDF と `manifest.json`) を tar にまとめ、10MB ずつに切って base64 の JavaScript に包みます (zip や tar を受け付けない格納先、たとえば claude.ai の Artifact に預けるため)。通常のファイルだけを包みます。
- `--unpack` は、バンドルの SHA-256 を確認して戻し、ネットを使わずに展開します (`--offline` と同じ)。
  バンドルの SHA-256 は同じ格納先の `samples-index.json` と比べるので、分かるのは壊れていないことだけで、出どころではありません。
  なので、展開の前に tar の中身を確認し、通常のファイルとディレクトリ以外 (シンボリックリンク・ハードリンク・装置ファイルなど) や、絶対パス・`..` を含む名前があれば、何も展開せずに止まります。
  所有者・権限は tar のままにしません (GNU tar の `--no-same-owner`・`--no-same-permissions`)。
- どちらも GNU tar を使います。

### サンプルと同じフォント・色で組む

- サンプルと同じフォントで組むには、フォントのファイルを `--fonts <ディレクトリ>` で渡し、総称ファミリー (`serif`・`sans-serif`) に当たる既定のフォントを `--web-fonts <ディレクトリ>` で差し替えます。
  MS 明朝・MS ゴシック・Times New Roman・Arial・Courier New を、`notoserif.ttf`・`notosans.ttf`・`tinos400.ttf`・`arimo400.ttf`・`cousine400.ttf` などの名前で置きます。
  TTC は、中の 1 つ目のフォントを TTF に取り出します。ディレクトリに無いフォントは配信元から取得します。
- サンプルが特色 (PDF の Separation の色。『CSS ページ組版入門』第 4 版の PANTONE 627 PC など) で塗っているときは、`node scripts/spot-colors-from-pdf.mjs <見本の PDF> -o spot-colors.json` で、サンプルの PDF に書かれた特色の名前と濃度 100% の代わりの CMYK を取り出します。
  Node のコマンドに `--spot-colors spot-colors.json` を付けて組み、組んだ PDF を `--pdf` で比べます。
  特色の値は Kumiori に入っていないので、渡さないと代わりの RGB で塗り、色がサンプルと違います。

### 目で見比べるページ (compare-view.mjs)

サンプルの PDF と Kumiori の PDF を、同じ名前で組にして、目で見比べるページを作ります。

```bash
node scripts/compare-view.mjs --ref <サンプルの PDF のディレクトリ> --pdf <Kumiori の PDF のディレクトリ> --out compare-view-out
```

`compare-view-out/index.html` をブラウザーで開きます。サンプルは差の大きい順に並び、ページごとに「並べる」「重ねる」(不透明度を変えられる)・「点滅」・「差」(青はサンプルにだけ、赤は Kumiori にだけ文字や線がある所) を切り替えて見られます。

| 付けるもの | 中身 |
| --- | --- |
| `--inline` | 画像を埋め込んだ HTML 1 つにする |
| `--jpeg` | ページの画像を JPEG にして小さくする |
| `--artifact` | claude.ai の Artifact として公開する形 (差の画像はブラウザーで描画する) で書き出す |
| `--ref-label`・`--pdf-label` | 左右の呼び名 (既定「サンプル」「Kumiori」) |
| `--title` | ページのタイトル |

呼び名とタイトルを変えるのは、サンプルの無い自作の FO を、Kumiori の 2 つのモードやほかの組版ソフトで組み比べるときです。自作のサンプルは `samples/check/` にあります。

## 前と後の組み比べ (compare-base.mjs)

直す前のコミットと後のコミットの Kumiori で、同じ文書を組み比べ、組版の結果の変わった文書とページを一覧にします。
直したい所だけが変わり、ほかの文書が変わっていないことを確認するために使います。git と poppler (pdfinfo・pdftotext・pdftoppm) が要ります。

```bash
npm run compare:base -- --base <前のコミット>              # 後は HEAD
npm run compare:base -- --base main --head .               # 後は作業の場所のいまのファイル (まだコミットしていない変更を含む)
npm run compare:base -- --base main --only conformance,examples,samples
```

- 2 つのコミットを一時的な場所に取り出して、それぞれで Node のコマンド (`dist-cli`) を作ります。作ったコマンドは `.cache/compare-base/<コミット>/` に置き、次からは作り直しません (`--no-cache` で作り直す)。
  コミットの `package-lock.json` がいまのものと同じなら、このリポジトリの `node_modules` を、その場所の隣に結んで (リンクにして) 使い、違えば、依存をその場所に `npm ci` で入れます。
  `--head .` のコマンドは `--out` の `build/` に作り、隣に `node_modules` を結ぶので、`--out` はリポジトリの外でもかまいません。
  `.cache` を別の作業の場所へのリンクにしても、組むときの依存は、走らせた作業の場所のものです (その場所の隣の結びを、走らせるたびに結び直す。同じ場所を 2 つの作業の場所から同時に使うと、結びを取り合うので避ける)。
- 組む文書は、群ごとに選べます (`--only`・`--skip`。`--filter <文字列>` で、名前にその文字列を含む文書に絞る)。手元にサンプルが無い群は飛ばし、報告に飛ばした理由を書きます。

| 群 | 文書 |
| --- | --- |
| `conformance` | 対応仕様説明書 4 冊 (`docs/conformance`。`npm run docs:conformance` と同じく、コードの表示を差し込んで組む) |
| `examples` | `examples` の HTML と FO |
| `samples` | `samples` の FO (仕様どおりのモードと `--compat antenna` の両方) と HTML |
| `generated` | 確認の文書を作るツールで作る文書 (いまは `scripts/gen-column-footnotes.mjs` の段組の脚注の文書 30 個と、`scripts/gen-stress-docs.mjs` の深い入れ子・大きな表・多くの CSS の規則・長い段落・多くの画像などの文書 7 個。後のバージョンのツールで 1 度だけ作り、前と後で同じ文書を組む) |
| `ah` | アンテナハウスのサンプル FO 集 (`--samples` のディレクトリ (既定 `.cache/samples`) の `fo/samples`。`--compat antenna`) |
| `css-print` | 『CSS ページ組版入門』第 4 版 (`--samples` のディレクトリの `css-print/src`。`--style ah`。特色の値は `--spot-colors` (既定 `.cache/spot-colors.json`)。無ければサンプルの PDF から取り出す) |
| `weasyprint` | WeasyPrint のサンプル ([CourtBouillon/weasyprint-samples](https://github.com/CourtBouillon/weasyprint-samples)。`--style weasyprint`。サンプルの `printall.sh` と同じ組み合わせの 8 つ) |

- WeasyPrint のサンプルは `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/CourtBouillon/weasyprint-samples <置き場>` で取得し、`--weasyprint <置き場>` で渡します (既定は環境変数 `KUMIORI_WEASYPRINT_SAMPLES` か、リポジトリの隣の `weasyprint-samples`)。
  サンプルの本文とフォントは、それぞれのライセンスの他の人の著作物を含むので、リポジトリには入れません。
- リポジトリの文書 (`conformance`・`examples`・`samples`) は、それぞれのコミットのものを組みます (文書を直したコミットなら、その直しも差に出ます)。手元のサンプルは、前と後で同じファイルを組みます。
- 既定のフォントは `.cache/fonts` (テストと同じディレクトリ) から読みます。`--fonts <ディレクトリ>` (既定は `.cache/ms-fonts` があればそれ) のフォントを、`ah`・`css-print` の群に渡し、総称ファミリーをサンプルと同じフォントにします。
  前と後を同じフォントで組めば比べられるので、サンプルと同じフォントが無くても組み比べはできます (報告に、どのフォントで組んだかを書きます)。
- PDF の日時は、環境変数 `SOURCE_DATE_EPOCH` で 2000-01-01 にして組みます。日時を渡せない前のバージョン (日時を組んだ時刻で書き、文書の識別子を乱数で作るバージョン) を組むときだけ、時計と乱数も止めます (`scripts/compare-base-freeze.mjs` を `node --import` で前読みする)。どちらのバージョンも、同じコードで同じ文書を組めば、同じバイトの PDF になります。
  止めたバージョンでは `Date.now()` が進まないので、時間の上限 (EPS の `epsMs`・リソースの取得の締め切りなど) が効きません。ふだんは時間の上限に当たる文書は、止めた前のバージョンと止めない後のバージョンで、結果や警告が違うことがあります。

比べ方と出力:

- PDF のバイト列が同じ文書は「バイトも同じ」とします。違えば、ページ数、ページごとの文字 (`pdftotext -bbox` の語と位置)、絵 (`pdftoppm` で `--dpi` (既定 50) のグレーでラスタライズし、輝度の差が 32 を超えるピクセル) を比べ、文字か絵の変わったページを「変わったページ」とします。
  ページ数・文字・絵がどれも同じでバイトの違う文書は「見た目は同じ (バイトは違う)」として分け、報告に一覧を書きます。
  この比べ方では、輝度の近い色 (CMYK・特色・ICC) の変わりや、出力の要件 (OutputIntent)・XMP・タグ付きの構造・注釈・しおりだけの変わりは見えず、「見た目は同じ」に入ります。そうした変更は、`pdfinfo`・veraPDF (`node scripts/verapdf.mjs`) などで別に検証します。
  警告・エラーの増減と、組版の秒が 1.5 倍を超えて遅くなった文書も書きます。
- `--out` (既定 `compare-base-out`) に `report.md`・`report.json` と、変わったページの、前・後・差を並べた絵 (`images/`。文書ごとに `--max-images` 枚 (既定 20) まで。差は、後にだけある文字や線を赤、前にだけあるものを青で描画する) を書きます。組んだ PDF は `pdf/base`・`pdf/head` にあります。
- 同時に組む数は `--jobs` (既定は CPU の数) です。全部の群 (文書 270 個) で、4 つの CPU で 6 分ほどです (コマンドを作る時間を除く)。

組版の結果が変わる修正をしたら、直す前のコミットを `--base` にして走らせ、変わった文書とページが、直したかった所だけかを確認します。
変わった文書とページ (報告の「変わった文書」の表) は、コミットの文に書きます。

### 意図した変化の一覧 (test/intended-changes.json)

組版の結果を変えるコミットは、変わる文書とページを `test/intended-changes.json` に書き足します。
`npm run compare:base -- --intended` (`npm run ci:local` の compare のジョブ) は、一覧を空にした、いちばん新しいコミットを前、いまのコミット (`--head`) を後にして組み比べ、一覧に無い変化があれば、終わりの状態を 1 にします
(前と後が同じコミットなら、組まずに終えます。`--base` を付ければ、そのコミットを前にします)。報告 (`report.md`・`report.json`) には、一覧に無い変化と、一覧にあって変わらなかった文書も書きます。

```json
{
  "changes": [
    { "commit": "表の罫線を、改ページの境界で選び直す", "docs": [{ "doc": "conformance/kumiori-xsl-fo.fo", "pages": [41, "88-90"] }, { "doc": "generated/stress/fotable.fo" }] },
    { "commit": "見出しの字間を直す", "docs": [{ "doc": "examples/*" }] }
  ]
}
```

- `commit` は、変えたことの短い説明 (コミットのタイトルなど) です。1 つのコミットで 1 つの項を追加します。
- `doc` は、組み比べの報告の文書の名前 (`conformance/kumiori-xsl-fo.fo`・`examples/drawio-pages/pages.html`・`samples/check/fo/indent-inheritance-1.fo (--compat spec)` など) です。`*` は、`/` を含む任意の文字の並びに当たります。
- `pages` は、変わってよいページ (後のバージョンのページの番号。`"88-90"` は 88〜90 ページ) です。書けば、そのページの文字と絵の変化、警告・エラーの変化、見た目の同じバイトの変化だけを許し、ほかのページの変化とページ数の変化で落とします。
  書かなければ、その文書のどんな変化 (ページ数の変化・片方のバージョンにだけある文書を含む) も許します。
- 後のバージョンで組めない文書は、一覧にあっても落とします。
- 一覧を空にするのは、組版の結果を変えないコミットで行います (リリースの後や、一覧が長くなったときに、`"changes": []` にするだけのコミット)。次からは、そのコミットからの変化を書きます。
- 一覧は前からの変化を足し合わせたものなので、同じページを後のコミットが意図せず変えても見分けられません。コミットごとの確認は、これまでどおり、直す前のコミットを `--base` にした組み比べで行います。

## 組版の時間の比べ (perf-compare.mjs)

前のコミットと後のコミットの組版の時間を、同じ機械で交互に測り比べ、後が大きく遅い文書を通知します (`scripts/perf-compare.mjs`)。

```bash
npm run perf:compare -- --base <前のコミット>               # 後は HEAD
npm run perf:compare -- --base v0.5.0 --head .              # 前のリリースと、作業の場所のいまのファイルを比べる
npm run perf:compare -- --base main --doc fo-spec --rounds 7
```

- 組む文書は、既定で、対応仕様説明書の HTML と XSL-FO (`html-spec`・`fo-spec`) と、種を決めた乱数の文書 (`scripts/gen-stress-docs.mjs`) の表・規則・段落・XSL-FO の入れ子です (`--doc` で選ぶ。名前は `scripts/profile-relayout.mjs` の `--doc` と同じ)。
  どちらのコミットでも、作業の場所の文書とフォントを組みます (組版のコードだけを比べる)。
- 機械の揺れは、次のように扱います。
  - 測るのは、組むスレッドの CPU の時間です (ほかのプロセスに CPU を取られて待った時間と、GC のほかのスレッドの時間が入らない)。壁の時計の時間も並べて書きます。
  - 前と後を、組ごとに順を入れ替えて交互に測ります (`--rounds` 組。既定 5)。1 つの組では、文書ごとに `--runs` 回 (既定 3) 組み、温まった回の一番短い値を取ります。
  - 組ごとの比 (後 ÷ 前) の中央値が `--threshold` (既定 1.1) を超え、組の 8 割以上で後のほうが遅いときに「遅い」とし、終わりの状態を 1 にします (`--no-fail` で 0)。
- 既定の文書と回数で、4 つの CPU の機械で 15 分ほどかかります (1 組の片方で 90 秒ほど)。`--json <ファイル>` で結果を JSON でも書きます。
- `npm run compare:base` は、多くの文書を 1 度ずつ並べて組み、組版の秒が 1.5 倍を超えた文書を報告に書きます (粗い監視)。このツールは、主な数個の文書で 1 割ほどの違いを見分けます (細かい確認)。
  `compare:base` の報告に遅くなった文書が出たときと、組版の計算量を変える変更 (組み直しの回・止めるシグナルの確認しなど) の後と、リリースの前 (前のリリースのタグと比べる) に走らせます。

### 時間を確認する試験

`npm test` の中で時間を確認する試験は、機械の速さと負荷 (ほかの試験のワーカー・ビルド) に揺れないように、`test/timing.ts` のツールで測ります。

- 時間は、壁の時計でなく、試験のスレッドの CPU の時間で測ります (`cpuClock`)。上限は `scaled(ミリ秒)` で書き、遅い機械では環境変数 `KUMIORI_TIME_SCALE` (既定 1) で何倍かにできます。
- 計算量の伸び方は、大きさ n と 4n を交互に測り、一番短い値どうしの比で見ます (`expectGrowth`。線形なら 4、2 乗なら 16 なので、上限は 8)。
  悪い入力は、同じ量のふつうの入力と交互に測った比で制約します (`expectRatio`)。どちらも、上限の内に入るまで 3 組まで測り直します。
- 悪い入力 (小さな入力で時間を使い切らせるもの) の試験は `test/hostileInputs.test.ts` に集めています。まだ直していない入力は `it.skip` にしてあり、直したら skip を外します。
- 種を決めた乱数の文書の指標 (ページ数・数行だけのページの数・警告) と伸び方は `test/stressDocs.test.ts` (段組の脚注の文書は `test/columnFootnoteReserve.test.ts`) で確認します。
  大きなバージョンは `node scripts/gen-stress-docs.mjs <ディレクトリ>` で書き出せ、`compare:base` の `generated` の群でも組みます。

## メモリの山の測り (measure-memory.mjs)

PDF を作るときのメモリの山を、`typesetToPdf` と、ストリームで書き出す `typesetToPdfStream` (書き出し先は `fs.writeSync`) で、メモリ節約 (`lowMemory`) の有り無しで測ります (`scripts/measure-memory.mjs`)。
PDF の書き出しやメモリ節約を変えたときに、山が上がっていないかを見ます。

```bash
node scripts/measure-memory.mjs                                  # 既定の文書を 4 つの形で
node scripts/measure-memory.mjs --doc images:200 --mode pdf --mode stream
node scripts/measure-memory.mjs --doc text:11200 --json mem.json  # 文だけの 1,600 ページの文書
```

- 文書は、対応仕様説明書の HTML と XSL-FO (`html-spec`・`fo-spec`)、文だけの文書 (`text[:節の数]`。作る)、画像の多い文書 (`images[:枚数]`。圧縮の効かない 600×600 の PNG を作る)、
  画像の多い本 (`book[:ページ:枚数]`。既定 197 ページ・1600×1000 の 8 ビット RGBA の PNG 333 枚。画像は `scripts/measure-png-embed.mjs` が作ったもの。先に `node scripts/measure-png-embed.mjs --env node` を 1 度走らせる)、
  手元にあれば『CSSページ組版入門』第 4 版 (`css-print`) です。形は `pdf`・`stream`・`pdf-low`・`stream-low` です。
- 文書と形ごとに新しい Node のプロセス (`--expose-gc`) で組み、20ms ごとと進捗のコールバックのたびに `process.memoryUsage()` を見ます。表には、ヒープ・外のバイト列 (`arrayBuffers`)・RSS の山と、
  組版の間の生きているヒープ (組み直しの回の 100 ページごとに、片付けてから見た量の山) と、PDF を書く間の生きている量 (片付けてから見た量) を書きます。
  ヒープの山は片付けの時機で揺れるので、前と後・流すか流さないかの比べには、生きている量を使います。
  組みながら確定したページを描画して手放す作り (`design/pdf-writer.md` の 12) で下がるのは、組版の間の生きているヒープです
  (文だけの 1,600 ページの文書で 525MB から 127MB)。0.8.0 からは、画像のある文書も組みながら描画します (`design/pdf-writer.md` の 13)。
  JSON には、進捗の段 (`resources`・`import`・`layout`・`pdf`) ごとの外のバイト列の山も書きます。`--no-build` で、前に作ったビルド (`.cache/measure-memory-build`) を使います。
- 画像の多い文書は、ツールが作った画像のバイト列を、組む間ずっと持っています (外のバイト列の初めの量に入ります)。
- 画像のある文書を組みながら描画する作り (0.8.0。`design/pdf-writer.md` の 13) の前 (3fe6117) と後の値 (2026-11-25。このコンテナ、Node 22.23.5・4 CPU。MB と秒):

  | 文書 | 形 | 組版の間の生きているヒープ | PDF を書く間の生きている外のバイト列 | 外のバイト列の山 | RSS の山 | 時間 |
  |---|---|---|---|---|---|---|
  | 画像の多い本 (`book`。197 ページ・PDF 70MB) | `pdf` | 56.4 → 56.0 | 215.8 → 200.3 | 280.0 → 279.4 | 536.5 → 484.5 | 21.5 → 18.9 |
  | 同 | `stream` | 56.4 → 55.8 | 165.7 → 144.4 | 187.9 → 220.8 | 425.6 → 411.5 | 21.3 → 19.9 |
  | 対応仕様説明書 HTML (`html-spec`。148 ページ) | `pdf` | 183.6 → 186.6 | 183.9 → 183.8 | 198.1 → 203.2 | 749.8 → 783.3 | 23.0 → 22.7 |
  | 同 | `stream` | 183.6 → 187.1 | 182.9 → 183.6 | 196.5 → 201.1 | 768.6 → 809.9 | 23.5 → 22.7 |
  | 画像の多い文書 (`images`。PNG 200 枚・PDF 196MB) | `pdf` | 49.1 → 53.0 | 469.0 → 261.0 | 786.5 → 565.0 | 1,169.8 → 925.0 | 3.7 → 2.4 |
  | 同 | `stream` | 49.1 → 52.9 | 275.7 → 260.9 | 773.7 → 574.1 | 961.9 → 743.9 | 3.6 → 2.4 |

  - 画像の多い文書の外のバイト列の山が下がったのは、画像の格納先が、渡された画像をコピーしなくなったため (測る側が初めから持つ 533MB の上に、前は 254MB、後は 40MB ほどを足す)。
  - 画像の多い本の組版の間の生きているヒープは、もともと小さい (ページの組版の途中の結果より、画像のほうが大きい)。ストリームで書き出すときの外のバイト列の山が 33MB 上がったのは、
    α 付きの PNG を組む前に用意する (RGB と α に分けて圧縮したもの。PDF の画像の量ほど) ので、それを初めて使うページまで持つため (前は、組み終えてから 1 枚ずつ埋め込んで書き出していた)。
  - 対応仕様説明書は、先頭に目次 (前向きのページ番号の参照) があるので、2 ページ目から後ろは組み終えてから描画し、生きている量は変わらない (ヒープ・RSS の山の違いは、片付けの時機と機械の揺れ)。
  - 文だけの 1,600 ページの文書 (`text:11200`) も、前と同じ (組版の間の生きているヒープ 127MB)。

## 画像の埋め込みの時間の測り (measure-png-embed.mjs)

α 付きの PNG の多い文書を PDF にする時間を、Node と、Chromium の Web Worker の中で測ります (`scripts/measure-png-embed.mjs`)。
画像の埋め込み (展開・圧縮) を変えたときに、ブラウザーと Node のどちらで遅くなっていないかを見ます。Chromium は `KUMIORI_CHROMIUM` の指すものです。

```bash
NODE_USE_ENV_PROXY=1 node scripts/measure-png-embed.mjs                     # Node と Worker の両方
node scripts/measure-png-embed.mjs --env worker --runs 3 --json after.json
node scripts/measure-png-embed.mjs --src ../kumiori-before --json before.json # git worktree で取り出した前のコミットを測る
```

- 試しの文書は、197 ページに、1600×1000 の 8 ビット RGBA の PNG 333 枚 (計 55MB ほど。画面のスクリーンショットに似せた絵で、四隅が透明) を 1 ページに 1〜2 枚置いたものです
  (`--pages`・`--images` で替えられます)。画像はツールが作り、`.cache/measure-png-embed/images` に置きます (リポジトリには入れません)。
- 組み方は、`createTypesetter` → `typeset` → `toPdf({ title, date, onProgress })` (deflate は渡さない) です。表には、組版・最初の `onProgress` (phase `pdf`) まで・`toPdf`・全体の時間と、
  α 付き PNG を入れる処理を 4 つに分けた時間を書きます: (a) 展開、(b) フィルタを戻す・RGB と α に分ける、(c) ピクセルの圧縮 (どれも、同じ画像の全部を、埋め込みと同じ関数で 1 枚ずつ処理して足した時間)、
  (d) そのほか (`toPdf` から (a)〜(c) を引いたもの。PDF のライター・ページの中身・フォントなど)。PDF の SHA-1 も出すので、前と後で同じバイト列かを比べられます。
- 既定のフォントは、Node は `.cache/fonts`、Worker は `.cache/measure-png-embed/fonts-web` にキャッシュします。初めはネットワークから取得するので、プロキシを通す環境では `NODE_USE_ENV_PROXY=1` を付けます。

## 描画のメモリと時間の測り (measure-render-memory.mjs)

描画 (`renderPage`) のメモリと時間を、Chromium の Web Worker の中で、使う側 (印刷プレビュー) と同じ形で測ります (`scripts/measure-render-memory.mjs`)。
Typesetter を 1 つ作り、同じ文書の結果を `--results` 件 (既定 2) 持ち、全部のページを `renderPage(OffscreenCanvas)` で 2 回描画します。画像のキャッシュ (`TypesetterOptions.imageCache`) を変えたときに走らせます。

```bash
node scripts/measure-render-memory.mjs                                     # 画像の多い本 (197 ページ・PNG 333 枚)、結果 2 件
node scripts/measure-render-memory.mjs --max-bytes 67108864 --no-build      # 画像のキャッシュの上限を 64MB にする
node scripts/measure-render-memory.mjs --src ../kumiori-before --json b.json  # git worktree で取り出した前のコミットを測る
```

- 文書は `scripts/measure-png-embed.mjs` と同じ試しの本です (画像は、先に `node scripts/measure-png-embed.mjs --env node` を 1 度走らせて作る)。
- 量は、Chromium の全部のプロセスの RSS の和 (`ps` で 100ms ごと) の山と、組み終えた所・描画し終えた所の値、Kumiori の見積もり (結果の `memoryUsage().images` の和・`Typesetter.memoryUsage()` の `cacheDetail.images`) です。
- 測った値 (2026-11-25。このコンテナ、Chromium 158・4 CPU。前は 3fe6117。MB と秒):

  | | 前 | 後 (上限 256MB。既定) | 後 (上限 64MB) |
  |---|---|---|---|
  | RSS の山 | 5,634 | 1,598 | 1,475 |
  | 組み終えた所の RSS | 5,350 | 1,218 | 1,216 |
  | 結果の `images` の見積もり (2 件の和) | 4,171.5 | 0 | 0 |
  | 画像のキャッシュ (`cacheDetail.images`) | — | 250.2 | 61.0 |
  | 組む時間 (1 件目・2 件目) | 6.1・5.8 | 5.1・4.2 | 5.7・4.6 |
  | 全部のページの描画 (394 ページ。1 回目・2 回目) | 1.2・1.1 | 7.1・7.5 | 7.8・8.2 |

  - 前は、読み込みのときに、どの結果も全部の画像を `ImageBitmap` にして持っていた (1 枚 6.4MB × 333 枚 × 2 件)。後は、描画するときにデコードし、Typesetter 全体で上限までを持つ。
  - 描画の時間が延びたのは、上限に収まらない画像を、描画するたびにデコードし直すため (この本は 333 枚で、上限 256MB は 40 枚ほど。1 枚 10ms ほど)。
    キャッシュに収まる画像 (見ているページの前後を描画し直すプレビューなど) は、2 回目からデコードしない。

## 組んだ結果のメモリの見積もりの測り (measure-result-memory.mjs)

組んだ結果と Typesetter のメモリの見積もり (`TypesetResult.memoryUsage`・`Typesetter.memoryUsage`) が、実際に手放して減る量 (`dispose`・`releaseCaches`) とどれだけ合うかを測り、
見積もりの係数 (`src/areaTree.ts` の `AREA_TREE_BYTES`・`src/fontManager.ts` の `FONT_BYTES_PER_GLYPH`・`src/layoutEngine.ts` の `REUSE_BYTES`) を決め直すときに使います (`scripts/measure-result-memory.mjs`)。
結果や Typesetter が持つもの (エリアツリー・フォント・再利用のキャッシュ) を変えたときに走らせ、見積もりが外れていないかを見ます。

```bash
node scripts/measure-result-memory.mjs                                   # 既定の文書 (Node)
node scripts/measure-result-memory.mjs --doc web:200 --doc web:200+noreuse
node scripts/measure-result-memory.mjs --browser --no-build --doc web:200  # Chromium の Web Worker の中で
```

- 使う側 (印刷プレビュー) と同じ条件で測ります: Typesetter は 1 つで再利用あり (既定)、画像・フォント・CSS は `resolveResource` で渡し、何度問い合わせても同じ `ArrayBuffer` を返します。
  同じ文書を 2 度組み (前の結果と直近の結果)、直近の結果・前の結果の順に `dispose()` し、再利用のキャッシュを前の文書のページ・行分け・フォントの下ごしらえの順に手放して、それぞれで減った量を見ます
  (量は、タスクを 1 つ待ってから片付け (`gc()`) を 2 回して、`heapUsed + arrayBuffers`)。
- 文書は、プレビューをまねた HTML (`web:<ページ>`。作る。`@font-face` の TrueType のフォント 3 つと、1 ページに段落 6 つ・画像 1.7 枚ほど)・対応仕様説明書の HTML と XSL-FO (`html-spec`・`fo-spec`)・文だけの文書 (`text:<節の数>`)・その前に節ごとのページ番号の目次 (`target-counter`) を置いた文書 (`toc:<節の数>`。前向きのページ番号の参照があり、組み直しの回がある) です。
  名前の後ろに `+noreuse` (再利用なし)・`+noface` (`@font-face` なし)・`+linesfirst` (キャッシュを行分けから手放す) を付けられます。係数は、再利用なしの結果の減った量 (画像とフォントを除く) と、
  `+noface` との差 (フォントの分)、キャッシュの減った量の和 (前の文書のページと行分けのキャッシュは行の節を共有し、先に手放した側では共有の分が減らないので、和で見る) から決めます。
- `--browser` は、Chromium (`KUMIORI_CHROMIUM`) の Web Worker の中で、同じ手順を動かします。量は Worker の CDP の `Runtime.getHeapUsage` の `usedSize` で、外のバイト列 (画像とフォントのファイルの中身・`ImageBitmap`) は入りません。
- 表の「残り」は、全部を手放した後に、組む前より残った量です (初めて組むときに読み込むモジュール・分綴の辞書・数式などのフォント)。結果や Typesetter の見積もりには入りません。
- 表の「memoryUsage の時間」は、`result.memoryUsage()` の 1 回あたりの時間 (ミリ秒) で、結果ごとの初めの 1 回 (エリアツリーを数える) と、2 回目から (200 回の平均) です。`web:200` で、Node 22 では 30ms・0.07ms、Chromium 158 の Web Worker では 24ms・0.27ms でした。
- 測った値 (2026-11。MB。Node 22.23.5 と Chromium 158 の Web Worker):

| 文書 | 処理系 | ページ | 領域 | 前の結果 (見積もり・減った量) | 直近の結果 (減った量) | キャッシュ (見積もり・減った量) | 再利用なしの結果 (見積もり・減った量) | 残り |
|---|---|---|---|---|---|---|---|---|
| `web:3` | Node | 3 | 2,771 | 5.9・1.7 | 4.3 | 2.9・9.4 | — | 5.9 |
| `web:20` | Node | 20 | 18,564 | 15.8・11.3 | 13.9 | 14.4・20.6 | — | 7.2 |
| `web:200` | Node | 200 | 187,104 | 120.8・113.9 | 116.1 | 136.6・140.5 | 120.8・121.0 | 11.6 |
| `html-spec` | Node | 148 | 260,963 | 152.5・154.4 | 97.7 | 275.4・288.7 | 157.2・158.4 | 78.2 |
| `fo-spec` | Node | 100 | 159,294 | 53.3・54.4 | 58.8 | 126.2・152.7 | 53.3・59.4 | 51.9 |
| `text:1500` | Node | 215 | 236,435 | 77.6・73.5 | 73.1 | 194.0・180.2 | 77.6・76.1 | 8.4 |
| `toc:1500` | Node | 252 | 267,268 | 88.7・87.2 | 88.1 | 227.0・197.3 | 88.7・89.8 | 13.3 |
| `web:20` | Chromium | 20 | 18,564 | 5.1・3.4 | 4.4 | 7.7・10.5 | — | 5.7 |
| `web:200` | Chromium | 200 | 187,104 | 37.9・34.2 | 34.9 | 77.2・80.2 | 37.9・37.4 | 7.2 |
| `html-spec` | Chromium | 148 | 260,963 | 75.8・70.8 | 53.3 | 136.5・135.3 | 80.5・71.2 | 35.2 |
| `fo-spec` | Chromium | 100 | 159,294 | 31.8・32.3 | 34.4 | 69.7・89.0 | 31.8・34.8 | 23.5 |
| `text:1500` | Chromium | 215 | 236,435 | 46.0・42.9 | 42.7 | 110.3・106.1 | 46.0・44.3 | 5.5 |
| `toc:1500` | Chromium | 252 | 267,268 | 53.1・50.5 | 50.8 | 129.0・116.3 | — | 7.8 |

  Chromium の行は、ブラウザーの係数 (`memoryRuntime()` が `browser`) での見積もりです。減った量に外のバイト列 (画像とフォントのファイルの中身・`ImageBitmap`) が入らないので、
  見積もりも `images` とフォントの下ごしらえを除いて書きます。JS の物は Chromium で小さく (V8 のポインタの圧縮)、再利用なしの結果の減った量から、領域 1 つは約 190〜220 バイト (Node は約 340)、
  フォントの字形 1 つは約 160〜200 バイト (Node は約 500)、キャッシュは Node のおよそ 0.57 倍だったので、ブラウザーの係数は 200・180・Node の 0.57 倍にしました。
  Firefox・Safari は測っていません (ブラウザーの係数を使います)。
  再利用のキャッシュの前の文書のページは、組み直しの 1 回目のページです (2 回目からの回で組み直した page-sequence も、1 回目のページをキャッシュします)。見積もりは、そのページの論理の木の節を数えます。
  2 回目からの回の文字の差し替えの前の中身 (`undo`) は、測った文書のどれでも 0 件だった (`toc:1500` も、差し替えでなく組み直しになった) ので、1 つあたりの大きさ (`REUSE_BYTES` の `undo`) は測らず、
  行分けのキャッシュの 1 つあたりと同じにしています。

## 先頭から N ページの組版の確認 (check-max-pages.mjs)

先頭から N ページで止めて組んだ 1〜N ページ (`--max-pages N`・API の `maxPages`) が、全体を組んだときの 1〜N ページと同じかを、文書ごとに数えます。
組版の本体 (改ページ・脚注・段組・組み直しの回) を直したときに、止めた組版がずれないことを確認するために使います。poppler (pdfinfo・pdftotext・pdftoppm) が要ります。

```bash
node scripts/check-max-pages.mjs                         # N は 1・3・10。手元にあるサンプルの群をすべて組む
node scripts/check-max-pages.mjs --only weasyprint,conformance --pages 2,5
```

- 群は `ah` (アンテナハウスのサンプル FO 集)・`css-print` (『CSS ページ組版入門』第 4 版)・`weasyprint` (WeasyPrint のサンプル)・`conformance` (対応仕様説明書の HTML と XSL-FO) です。
  サンプルの格納先は、前と後の組み比べと同じです (`--samples`・`--weasyprint`)。コマンドは `dist-cli` を使い、無ければ `npm run build:cli` で作ります。時計と乱数は止めて組みます。
- ページごとに、文字 (`pdftotext -bbox` の語と位置) と絵 (`pdftoppm` で `--dpi` (既定 40) のグレーのピクセル) を比べ、違うページを次のどれかに分けます。
  - 参照の文字だけ: 行の並びが同じで、数字・`"?"`・リーダーの点を除けば語の並びも同じ (N より後ろを指す参照が `"?"` になった)
  - 行分けまで変わった: 行の並びか、ほかの語が違う
  - 絵だけ違う: 文字は同じで、絵だけ違う
- N より後ろを指す参照の警告 (`layout/beyond-max-pages`) が出なかったのに違うページは「警告が無いのに違うページ」として数えます。0 でなければ、組版の作りのエラーを疑います。
- `--out` (既定 `.cache/check-max-pages`) に `report.md`・`report.json` を書きます。

## 再利用の有無の組み比べ (check-relayout.mjs)

タイプセッター (`createTypesetter`) が前の文書の組版のキャッシュを再利用して組んだ結果が、再利用しないとき (`reuse: false`) と同じかを確認します。
文書を、種を決めた乱数の所で少しずつ直し (文字を追加する・消す・置き換える。タグと文字参照は壊さない。ときどき、ブロックに組み方の属性を追加する直しと、ページのマスター (XSL-FO の領域・HTML の `@page`) に背景の色を追加するだけの直しもする)、「元の文書・直したもの (`--edits` 個。重ねて直す)・元の文書に戻したもの」を、
再利用するタイプセッターと再利用しないタイプセッターで順に組んで、エリアツリー・診断 (場所の行と桁まで)・警告・PDF のバイト列 (時計と乱数は止める) を比べます。違えば、再利用の側のエラーです。
タイプセッターの再利用や、途中から組み直す作りを直したときに使います (モジュールは `scripts/relayout-check-lib.mjs`。比べるタイプセッターと、組んだ結果から報告に出す数を足せる形にしてあります)。

```bash
node scripts/check-relayout.mjs --jobs 4                          # 手元にある群をすべて組む
node scripts/check-relayout.mjs --only conformance,css-print --seed 2 --edits 5
```

- 群は `conformance` (対応仕様説明書の日本語と英語)・`examples`・`samples`・`generated` (`scripts/gen-stress-docs.mjs` の文書)・`ah`・`css-print`・`weasyprint` です。
  サンプルの格納先は、前と後の組み比べと同じです (`--samples`・`--weasyprint`)。フォントは既定のフォントで組みます。
- 文書ごとに 1 行 (バージョンの数・ページ数・再利用した段落の数・時間) を出し、違ったバージョンは、どこが違うか (エリアツリーは最初に違うページ、PDF は最初に違うバイト) を出します。
  違うバージョンがあれば、終わりの状態が 1 になります。`--json` で結果を書きます。
- `--jobs` は、文書を組むプロセスの数です。空いたプロセスに、重い文書 (対応仕様説明書・『CSSページ組版入門』) から順に 1 つずつ渡し、
  同時に組む文書のメモリの見積もりの合計を、機械のメモリの 8 割までに抑えます (対応仕様説明書の HTML と CSS 編は 1 冊で 5GB、XSL-FO 編は 4GB ほどになるため)。
- `--skip` で群を除き、`--no-pdf` で PDF のバイト列を比べずに速く回します。`--src`・`--no-build` は `scripts/profile-relayout.mjs` と同じです (組版のソースの場所・前に作ったビルドを使う)。
- 小さな文書の速いバージョンは `test/relayoutCheck.test.ts` で、`npm test` に入っています。代表の文書で、再利用・連結する確認 (`splice-verify`)・途中から再開する作り・遅く戻る試しをまとめて確認する速い組は
  `test/relayoutAlways.test.ts` です。リポジトリの文書の全部は、`npm run ci:local` の relayout のジョブで確認します。
- `generated` の群には、章ごとに page-sequence を分け、脚注・マーカーのある XSL-FO (`generated/fofootnotes`・`generated/fomarkers`) も入ります。行の `page-sequence` に、前の文書から再利用した page-sequence の数が出ます。

### 途中から再開する作りの確認 (check-resume.mjs)

組版は、1 段の page-sequence を、ページの境界で止めて、コピーした状態から続きを組めます (最後のページのマスターを選び直すとき、途中から再開できる境界から組み直します)。
`scripts/check-resume.mjs` は、途中から再開できる境界のすべてで、1 ページ先まで組んでから境界に戻り、コピーした状態から続けて組むタイプセッター (`--subjects resume`) で組み、
再利用しないタイプセッターで組んだものと、上と同じものを比べます。戻って同じ境界に来たときの、境界のフィンガープリントも比べます。途中から再開する作りを直したときに使います。

```bash
node scripts/check-resume.mjs --jobs 4                            # 手元にある群をすべて組む (check-relayout.mjs を --subjects resume --edits 0 で走らせる)
node scripts/check-resume.mjs --only ah --filter keep             # 群・名前で絞る (引数は check-relayout.mjs と同じ)
node scripts/check-resume.mjs --late 4 --jobs 4                   # 遅く戻る試し (下)
```

- `--late N` は、page-sequence を終わりまで組んだ後、途中から再開できる境界を N 個ほど散らして選び、後ろから順に、境界に戻って終わりまで組み直すタイプセッター
  (`--subjects resume-late`) で試します。組版の中で境界から組み直す使い方 (最後のページのマスター) と同じ形で、境界の 1 ページより後で、
  コピーと共有の物を書き換えるエラーを探します。組み直すたびに、その組み直しの流れがコピーした次の境界からも、もう 1 度終わりまで組み直します
  (続けた流れがコピーする境界のエラーは、1 度続けただけでは結果に出ず、その境界から続けたときに出るため)。
- `generated` の群には、左右 (HTML の `@page :left`)・奇数偶数のマスターで本文の幅が違い、ページをまたぐ長い段落の続く文書 (`generated/sidewidth`・`generated/fosidewidth`) も入ります。
  段落の途中の境界から続けると、行の長さの変わるページで残りの行を組み直すので、その間にコピーする境界のエラーを探せます。
  border-collapse: collapse の表 (隣り合うセルが境界線を共有する表。2 行をまたぐセル・分けない指定の行・繰り返す表ヘッダー) がページをまたぐ文書 (`generated/collapsetable`・`generated/focollapsetable`。FO は最後のページのマスターのあるもの) も入ります。
  改ページの境界の罫線は、組んだ行のセルの辺を書き換えて決めるので、前の組みの書き換えが組み直しに漏れるエラーを探せます。

- 文書ごとの行に、コピーした境界・途中から再開できた境界・続けた回数と、途中から再開できない境界の理由ごとの数 (`site:children/child:<種類>` は途中から再開できない子のブロックの中 (`block-container-columns` は段組のブロックコンテナー)、
  `site:inline` は回り込みのある行の並びの中、など) を出します。
- 小さな文書の速いバージョンは `test/resume.test.ts` で、`npm test` に入っています。

## エリアツリーのフィンガープリント (npm run fingerprints:update)

主な文書のエリアツリーのフィンガープリントを `test/fingerprints/` に置いていて、組版の結果が変わると `npm test` が落ちます (`test/fingerprint.ts`)。

- フィンガープリントは、`serializeAreaTree` と同じ JSON の SHA-256 です。数は 1/1000 pt に丸め、画像のデータなどのバイトの並びは、その SHA-256 にしてから計ります。文書の全体のフィンガープリントと、ページごとのフィンガープリントを持ち、落ちたときは、変わったページの番号を出します。
- 比べる文書: 対応仕様説明書 4 冊の、サンプルの 1 つずつと文書の全体 (日本語版は `test/conformance.test.ts`・`test/fingerprints/conformance.json`、英語版は `test/conformanceEn.test.ts`・`test/fingerprints/conformance-en.json`)、`examples/drawio-pages` の文書と、`samples/check` の FO の 2 つのモード (`test/fingerprints.test.ts`。`test/fingerprints/documents.json`)。
- フォントは既定のフォントを `.cache/fonts` から読みます (置いてあればネットワークを使いません)。フィンガープリントを計る分の時間は、合わせて数秒です (`test/fingerprints.test.ts` は 3 秒ほど。対応仕様説明書の試験は、もともと全部のサンプルを組んでいて、フィンガープリントを追加しても 2 分半ほどのまま)。

意図して組版の結果を変えたときは、フィンガープリントを書き直します。

```bash
npm run compare:base -- --base <直す前のコミット> --head .   # どの文書のどのページが変わったかを確認する
npm run fingerprints:update                                  # フィンガープリントを書き直す (フィンガープリントの試験を、比べずに、いまのフィンガープリントを書く形で走らせる)
git diff --stat test/fingerprints                            # 書き直したフィンガープリントの文書を見る
```

`npm run fingerprints:update -- -t <試験の名前>` のように絞ると、組んだ文書のフィンガープリントだけを書き直し、組まなかった文書のフィンガープリントはファイルにあるものを残します (警告で落ちてフィンガープリントを計れなかった文書も、前のフィンガープリントのまま残す)。
ファイルから消すのは、もう組まない文書 (試験の一覧に無い文書) のフィンガープリントだけです。

フィンガープリントを書き直したコミットの文には、フィンガープリントの変わった文書 (試験の失敗の文か `git diff` で分かる) と、変わった理由 (何を直して、どのページの何が変わったか。前と後の組み比べの結果) を書きます。
意図していない文書のフィンガープリントが変わったら、書き直さずに、その変わりが正しいかを確認します。
