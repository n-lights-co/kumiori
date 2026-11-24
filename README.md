<p align="center"><img src="assets/logo/kumiori-logo.svg" alt="Kumiori 組み織り" width="480"></p>

<p align="center"><b>AI で磨き上げた、日本語組版のためのライブラリ。</b></p>

<p align="center">日本語 ・ <a href="README.en.md">English</a></p>

# Kumiori（組み織り）

Kumiori は、HTML+CSS と XSL-FO から、本や文書のページを組む組版エンジンです。
縦書き・ルビ・禁則などの日本語組版を、規格に沿って組みます。
ブラウザでも Node でも動き、Canvas のプレビューと PDF に出力します。

## 特徴

- **日本語組版を規格どおりに** — 縦書き・ルビ・縦中横・禁則・約物の詰め・割注を、W3C の JLREQ に基づいて組みます。
- **ブラウザの中だけで、PDF まで** — サーバーも、ほかの組版ソフトも要りません。組版から PDF の書き出しまでをブラウザの中で行い、文書を外へ送りません。同じエンジンが Node でも動きます。
- **HTML+CSS と XSL-FO** — CSS の Paged Media・GCPM と XSL-FO 1.1 を、ブラウザの描画に頼らず、自前で解釈します。
- **印刷と保存に使える PDF** — 書体の埋め込み、トンボ、PDF/X・PDF/A、タグ付き PDF と PDF/UA-1 に対応します。
- **多くの言語と文字** — 右から左の文字、タイ語やインド系の文字、モンゴル文字の縦書きなども組めます。
- **仕様書を読み、AI で磨く** — 仕様書の定義に沿って実装し、公開の見本の PDF と組み比べています。コードの多くは AI ([Claude Code](https://claude.com/claude-code)) が書き、人が決めて確かめています。

## はじめかた

**画面で** — <https://n-lights-co.github.io/kumiori/> を開き、HTML・XSL-FO・EPUB を選んで「PDF を保存」。
組版はブラウザの中で行い、文書を外へ送りません ([画面の使い方](docs/app.md))。

**コマンドで** — Node から、ブラウザを使わずに PDF にします。まとめての変換、ページごとの SVG・PNG、CI 向けの診断にも対応します ([コマンドの説明書](docs/cli.md))。

```bash
npx kumiori book.html -o book.pdf     # 入れて使うなら npm install -g kumiori
```

**ライブラリで** — 自分のプログラムから組みます ([ライブラリの説明書](docs/library.md))。

```ts
import { typeset } from 'kumiori';   // npm install kumiori

const result = await typeset(html, { name: 'book.html' });
const pdf = await result.toPdf();    // Uint8Array
```

既定の書体 (Noto Serif JP など) はパッケージに入れておらず、初回に Google Fonts から取ります (Node のコマンドは手元のキャッシュに保存して使い回す。[書体](docs/fonts.md))。

## できること

| 分類 | 主なもの |
| --- | --- |
| 入力 | HTML+CSS、XSL-FO (アンテナハウスの拡張 `axf:*` の一部も)、EPUB (画面)、画像 (PNG・JPEG・SVG・EPS・CGM・WMF など)、draw.io の図 |
| 日本語組版 | 縦書き・横書き、ルビ、縦中横、圏点、割注、禁則、ぶら下げ・追い出し、約物の詰め、和欧間のアキ |
| 多言語 | アラビア語・ヘブライ語、タイ語、インド系・東南アジアの文字、ハングル、中国語、モンゴル文字、欧文の分綴 |
| ページ | ページマスター、柱・ノンブル、脚注、段組、回り込み、ページをまたぐ表、ページ番号の参照 |
| 出力 | Canvas、PDF (しおり・リンク・フォーム・トンボ)、タグ付き PDF・PDF/UA-1、PDF/X・PDF/A、ページごとの SVG・PNG |
| 環境 | ブラウザ (バンドラーでも、CDN の 1 ファイルでも) と Node |

PDF/X-1a と PDF/X-4 は、規格 (ISO 15930-1・ISO 15930-7) の本文を読んで作り、その決まりに適合することを確かめています。書き出した PDF も、その決まりで調べます。入稿の前には、プリフライトで確かめてください。
PDF/A は、規格の本文ではまだ確かめていないので、保存の前に検査の道具で確かめてください。
文字ごとの書体・画像の形式・PDF/X の規格の細目などは、[できることの一覧](docs/features.md) にあります。

## 説明書

| 説明書 | 中身 |
| --- | --- |
| [できること](docs/features.md) | 機能の詳しい一覧 (入力・日本語組版・多言語・ページ・出力) |
| [画面の使い方](docs/app.md) | 開く・保存・設定・警告 |
| [コマンド](docs/cli.md) | オプションの一覧・例・環境変数・終了の状態 |
| [ライブラリ](docs/library.md) | `typeset` の選択肢、PDF・Canvas・SVG・PNG、Web Worker、Node の部品、[API の安定性](docs/library.md#api-の安定性-版をまたいだ約束) (版をまたいで保つもの) |
| [API の説明書](https://n-lights-co.github.io/kumiori/api/) | すべての関数・型・選択肢 (型の宣言から作った一覧) |
| [対応仕様説明書](docs/conformance/README.md) | 仕様の項目ごとの対応と扱い |
| [診断](docs/diagnostics.md) | 警告と誤りの名前・重さ |
| [書体](docs/fonts.md) | 既定の書体とライセンス、キャッシュ、オフライン |
| [draw.io の図](docs/drawio.md) | 図の置き方・ページの選び方 |
| [構成](docs/architecture.md) ・ [Area Tree](docs/area-tree.md) | 内部の仕組みとファイルの役割、組んだ結果の形 |
| [開発とテスト](docs/development.md) | 開発の方法、手元での動かし方、テスト、見本との比較 |
| [変更の記録](CHANGELOG.md) ・ [公開の手順](docs/RELEASING.md) | 版ごとの変更、版の出し方 |

## 動く環境

Node は 22.12.0 以上です (CI は下限の 22.12.0 と、22 の新しい版で確かめています)。
Deno (2.x) と Bun (1.x) でも、ライブラリとコマンドが動きます (Node の互換の API で動きます)。ブラウザでは、Web Worker の中でも組めます。確かめた範囲は [パッケージの形と動く環境](docs/library.md#パッケージの形と動く環境) にあります。

## ライセンス

コードは [Apache License 2.0](LICENSE) です (Copyright 2026 Northern Lights Co.。[NOTICE](NOTICE))。
組版用の書体は同梱していません (書体とそのライセンスは [書体](docs/fonts.md))。
使っている第三者のソフトウェア (pdf-lib・pako・utif・hyphen など) のライセンスと著作権表示は、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にまとめています。

## 脆弱性の報告

公開の Issue には書かず、[SECURITY.md](SECURITY.md) の手順で、非公開で知らせてください。

## 他社の製品との関係

Kumiori は、アンテナハウスの製品や、WeasyPrint・Vivliostyle などの組版ソフトとは関係のない、独立したプロジェクトです。これらの会社やプロジェクトから、承認や支援を受けているものではありません。

Kumiori は draw.io (JGraph Ltd・draw.io AG) とも関係がありません (draw.io は登録商標です)。draw.io の図のファイルを読む機能は、draw.io の公開のソースを移して作ったもので (`THIRD_PARTY_NOTICES.md` の 13 節)、draw.io の承認や支援を受けたものではありません。

README や docs に出てくる製品名・会社名は、各社の商標または名称です。互換のための機能 (`axf:*` の拡張の読み込み、`--compat antenna` の既定値など) と、draw.io の図のファイル (`.drawio`・`.dio`) を読む機能を説明するために、これらの名前を使っています。
