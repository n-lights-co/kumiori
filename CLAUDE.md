# Kumiori の開発の決まり

このファイルは、AI のコーディング支援 [Claude Code](https://claude.com/claude-code) がこのリポジトリで作業するときに読む決まりです (Claude Code は、リポジトリの直下の `CLAUDE.md` を作業の指示として読みます)。
人が開発に加わるときの目安にもなります。開発の進め方は README の「開発の方法について」も見てください。

## 言葉

- 作業の経過・報告・質問は、日本語で書く (作業の途中の経過も含む)。
- コードのコメント・コミットの文・PR の文・文書も日本語で書く。英語版のある文書 (`README.en.md`、`docs/en/`、説明書の `.en.*`) は、日本語版を直したら英語版も同じように直す。

## 確かめ方

- 変えたら `npm run typecheck` と `npm test` を通す。画面 (`index.html`・`src/main.ts`) の動きを変えたら `npm run e2e` も通す。
- 組版の結果 (字・線・画像の位置や形) が変わる修正をしたら、見本と組み比べて、どこがどう変わったかを確かめ、PR に書く。
  見本との比べ方は、README の「テスト」の節の「見本の PDF との比較」(`scripts/compare-pdf.mjs`・`scripts/compare-view.mjs`) にある。
- 見本の比較ページ (`scripts/compare-view.mjs --artifact` で作るもの) を公開して見ている場合は、変化の及ぶ比較ページを作り直して公開し直す。

## 仕様の根拠

- 動きは仕様書 (W3C の XSL-FO・CSS・SVG・MathML、ISO の PDF・CGM など) を読んで決め、根拠の節の番号をコメントに書く。
- 他の組版ソフトに合わせる動きは、仕様どおりの動きと分けて、互換の指定 (`--compat antenna`・`--style ah|weasyprint|vivliostyle` など) のときだけにする。

## リポジトリに入れないもの

- 有償の規格書 (ISO/IEC など) の本文や PDF。参照するときは、規格の番号と節の番号だけを書く。
- 他社の製品のマニュアルの文の引用。
- 見本の PDF・画像・文書など、他の人の著作物 (比べるための見本は、各自が手元に用意する)。
- 書体のファイル (テストは `.cache/fonts` に取得して使う。`.gitignore` 済み)。
