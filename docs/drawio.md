> English: [en/drawio.md](en/drawio.md)

# draw.io の図

Kumiori は、draw.io (diagrams.net) の図のファイル (`.drawio`・`.dio`。mxGraph の XML。中身を圧縮したページも) を、画像としてそのまま読みます。
図のページを SVG にし、PDF に図形と文字のまま入れます (画像にしない)。描画するのは最初のページで、ほかのページは参照の `#` の後ろで選びます ([ページの選び方](#ページの選び方))。

Kumiori は draw.io (JGraph Ltd・draw.io AG) とは関係がありません (draw.io は登録商標です)。

既定で読みます (API の `drawio: false`、コマンドの `--no-drawio`、画面の設定の「draw.io の図を読む」で止められます)。
図を描画する処理 (rough.js を含む) は、文書に draw.io の図が出てきたときだけ読み込みます (CGM・EPS・WMF・EMF と同じ。画面とブラウザー向けのライブラリでは別のファイル)。
処理は `src/drawio/` にあります。

## 使い方

### API

```js
import { typeset } from 'kumiori';

const r = await typeset('<p><img src="fig.drawio"></p>', {
  files: [{ name: 'fig.drawio', data: figBytes }],
  drawio: { fetchStencils: true },
});
```

`TypesetOptions.drawio` (型は `DrawioOptions`。`false` なら draw.io の図を画像として読まない) のオプション:

- `stencils`: 図形ライブラリのファイル (`{ name, data }` の配列)。draw.io の配布物の `js/stencils.min.js` (draw.io のすべてのライブラリ) か、ライブラリの XML (`<shapes name="mxgraph.…">`)。名前が `.svg`・`.png`・`.jpg` のファイルは、draw.io の配布物の画像 (SAP のアイコンの中の画像 `img/lib/sap/`・クリップアート `img/lib/clip_art/` など) として、ファイルの名前で引きます
- `fetchStencils`: 図が使う図形ライブラリ・配布物の画像が `stencils` に無いとき、draw.io の配布物からネットワークで取得するか。既定 `false` (取得しない。描画できない形は文字だけ描画して警告する)。`true` ならバージョンを固定した draw.io の公開のリポジトリから (図形ライブラリは `stencils.min.js`。約 6.6MB)、文字列なら、その URL の `stencils.min.js` と、同じ場所の下の画像から取得します。関数 `(path, { url, fetch }) => 中身` なら、要るときに配布物の中のパス (`js/stencils.min.js`・`img/lib/sap/<名前>.svg` など) を渡して呼びます (手元にキャッシュしておくときに使う)
- `stencilsUrl`: `fetchStencils` が `true` か関数のときの取得先 (`stencils.min.js` の URL)
- `provideStencils`: 図形ライブラリのレジストリを、組版の外で持つときの関数 (`(libraries, images) => レジストリ`)。足りないライブラリの名前 (`aws4` など) と配布物の画像のパスを渡して呼び、返したレジストリで描画し直します。レジストリ (型 `DrawioStencilRegistry`) は `createDrawioStencilRegistry(files)` で作り (`files` は `stencils` と同じ形。読めないファイルがあれば拒否する)、足りないものはレジストリの `add(中身の文字列, ファイルの名前)`・`addImage(配布物の中のパスかファイルの名前, 中身)` で追加します。渡すと `stencils`・`fetchStencils` は使いません

図が URL (http(s)) で指す画像は、文書の画像と同じ規則 (`resolveResource`・`fetchImages`) で取得します。
文字の幅 (折り返し・ボタンの幅など) は、Kumiori が PDF に文字を描画するフォントで測ります。
警告の文は、`lang` (コマンドは `--lang`・環境) に従って日本語か英語で書きます。

`kumiori` から、draw.io の図の MIME の型 `DRAWIO_MIME`、中身が draw.io の図かを見る `isDrawio`、型 (`DrawioOptions`・`DrawioFile`・`DrawioFileData`・`DrawioStencilFetcher`) を出しています。
同じ拡張子・中身を読むプラグイン (`plugins`) を渡したときは、プラグインの形式を先に判定します。

### コマンド

```sh
kumiori doc.html --drawio-stencils ./stencils --fetch-drawio-stencils
```

- `--drawio-stencils <ファイルかディレクトリ>`: 図形ライブラリと配布物の画像 (ディレクトリなら、その中 (下のディレクトリも) の `.xml`・`.js`・`.svg`・`.png`・`.jpg`)。`,` で区切って何個でも (何度でも書ける)
- `--fetch-drawio-stencils`: 足りない図形ライブラリ・配布物の画像を、draw.io の配布物 (v24.7.5) から取得するのを許す。取得したものはフォントのキャッシュの場所 (`--font-cache`) に保存し、次からはネットワークに行きません (`--no-font-cache` なら保存しない)
- `--drawio-stencils-url <URL>`: 取得先の `stencils.min.js` の URL (http(s))。`--fetch-drawio-stencils` も付けたことになる
- `--no-drawio`: draw.io の図 (`.drawio`・`.dio`) を画像として読まない

`--watch` は、`.drawio`・`.dio` の変更も監視します。

### 画面

画面 (デモの Web アプリ) の「設定」の「draw.io の図」の項目で、図を読む・読まない (既定は読む。切ると、図を描画する処理を読み込みません)、図形ライブラリのファイルの読み込み (ブラウザーにキャッシュする)・消去、図に要るときだけ draw.io から取得するか (既定は取得しない) を選べます。
開くファイルと一緒に図形ライブラリ (`stencils.min.js`・ライブラリの XML) を渡すと、その画面の間だけ使います。

## ページの選び方

1 つのファイルにページ (draw.io の画面の下のタブ) が幾つもあるときは、画像の参照の `#` の後ろで、描画するページを選びます。何も書かなければ最初のページです。

```html
<img src="fig.drawio">              <!-- 最初のページ -->
<img src="fig.drawio#page=2">       <!-- 2 ページ目 (1 から数える) -->
<img src="fig.drawio#page-id=abc">  <!-- id が abc のページ (ファイルの <diagram id="…">) -->
<img src="fig.drawio#詳細図">        <!-- 名前が「詳細図」のページ (無ければ、id が「詳細図」のページ) -->
```

- `page=N` の数え方は、PDF の `#page=N` と同じく 1 から数えます (draw.io の画面の URL の `page` は 0 から数えるので、1 ずれます)
- 名前の空白・日本語は、`%20`・`%E8%A9%B3…` と書いても同じです
- 無いページを指したときは、最初のページを描画して警告に出します
- 同じファイルの違うページを、1 つの文書の中で使えます (それぞれ別の画像になります。`#` の後ろの違う参照は、1 つのファイルにつき 64 種類まで)

サンプル: [`examples/drawio-pages/`](../examples/drawio-pages/README.md) (3 ページの図と、それぞれの書き方で置いた文書。HTML と XSL-FO)

## 描画するもの

形・線・矢印は、draw.io と mxGraph の公開のソース (Apache License 2.0) を移して描画します。

- 標準の形 (UML・シーケンス図・フローチャート・git・mermaid など)、AWS・GCP・Cisco などのパッケージの形、スイムレーン・表
- draw.io が JavaScript で描画する形 (`shapes/*.js` のモックアップ・ArchiMate・BPMN・リーン生産・間取り図・ER 図・AWS の立体・電気回路・iOS の画面・UI・矢印など、約 750 種類)
- 図形ライブラリの形 (`mxgraph.*`) と、図に埋め込んだ形 (`stencil(…)`)。図形ライブラリは渡すか、取得するのを許したときだけ
- 線: 直角に曲げる線・自分へ戻る線・シーケンス図の線・曲線・線の跳び越し、太い矢印 (`flexArrow`・先細りの `taperedArrow` など)、線の端の形 34 種類
- HTML の書式の付いた文字 (折り返し・行ごとの揃え)、形ごとの文字の領域 (`boundedLbl`)、曲げた文字 (`curvedText`)
- 影 (形の影・文字の影・図の全体の影)、ガラスの光沢、グラデーション (両端の不透明度も)、手書き風 (`sketch`。rough.js)・ゆらした線 (`comic`)
- 画像 (`data:` の PNG・JPEG・SVG、URL の画像、draw.io の配布物の画像)

描画しないもの・違いうるもの:

- 図形ライブラリが無い形は、文字だけ描画して警告する
- 文字の幅は Kumiori が描画するフォントで測るので、折り返す所が draw.io の画面と違うことがある
- v24.7.5 より後に draw.io に追加された形と style のキーは読まない (形 (`mxgraph.archimate4.*`・`mxgraph.bpmn.task2` など) は、図形ライブラリを渡しても描画せず、文字だけ描画して警告する。下の「図形ライブラリの利用の条件」)
- 小さなファイルで時間・メモリを使い切る細工した図に備えて、読む量・描画する量に上限がある (値と根拠は `src/drawio/drawio.ts` の `LIMITS` など)。上限を超えた部分は描画せずに警告を出す

## 取得した図形ライブラリ・画像の確認

`fetchStencils` が `true` (コマンドは `--fetch-drawio-stencils`) で、既定の取得先 (draw.io の公開のリポジトリの、v24.7.5 のタグの URL) から取得したファイルは、中身の SHA-256 を、Kumiori が持つ v24.7.5 の一覧 (`src/drawio/drawioHashes.ts`。図形ライブラリの `js/stencils.min.js` と、`img/` の下の画像 1,901 個) と照合します。
タグは付け替えられる (同じ URL で中身が変わりうる) ので、一覧を作ったときの中身と同じものだけを使います。
合わないファイルと、一覧に無いファイルは使わずに、「draw.io の配布物 (v24.7.5) から取得したファイルの中身が、バージョンの SHA-256 の一覧と合わないので使いません」・「draw.io の配布物 (v24.7.5) の SHA-256 の一覧に無いファイルなので使いません」と警告します (その形・画像は、取得できなかったときと同じく描画しません)。

- `fetchStencils` を関数にしたときも、既定の取得先の URL を渡して呼んだ分 (`stencilsUrl` を渡さないとき) は、返した中身を照合します (手元にキャッシュしたものも、v24.7.5 の中身であること)。
- コマンドのキャッシュ (`--font-cache` の場所) も、合わない中身はキャッシュせず、合わないキャッシュは使わずに取得し直します。
- 取得先を自分で決めたとき (`fetchStencils` の URL の文字列・`stencilsUrl`。コマンドは `--drawio-stencils-url`) は、そのバージョンの一覧を Kumiori が持たないので照合しません。
- `stencils` (コマンドは `--drawio-stencils`) で渡すファイルは照合しません。

### 取得先のバージョンを上げるとき (Kumiori を直す人へ)

一覧は、`scripts/drawio-hashes.mjs` が、draw.io のリポジトリのタグの指すコミットの中身 (git で、`src/main/webapp/img/` と `src/main/webapp/js/stencils.min.js` だけを取り出したもの) から作ります。

1. `src/drawio/drawioStencil.ts` の `DRAWIO_STENCILS_URL` のタグを書き換える (そのバージョンの `stencils/`・`img/` の LICENSE を確認し、このドキュメントの「図形ライブラリの利用の条件」と THIRD_PARTY_NOTICES.md の 13 節も合わせる)。
2. `node scripts/drawio-hashes.mjs --tag <新しいタグ>` で一覧を作り直す (git が要る。数秒)。タグは `DRAWIO_STENCILS_URL` と同じにする (`test/drawio/drawioFetchHash.test.ts` が確認する)。
3. 一覧の先頭に書かれたコミットが、draw.io のリポジトリのタグのコミットと同じことを確認し、`npm test` を通す。

## 図形ライブラリの利用の条件

Kumiori は draw.io の図形ライブラリのデータ (`stencils/` の XML と `js/stencils.min.js`) とアイコンの画像を含みません。
JavaScript で書かれた形 (`src/drawio/drawioJs/`。AWS 3D・モックアップ・電気の図など) は、draw.io の `shapes/` の形を書き直したものです。
draw.io は v29.3.2 (2026-01) から、`shapes/`・`stencils/`・`img/` に、Atlassian の製品とその marketplace・plugin の製品に使うことを禁じる LICENSE を付けました。
Kumiori の `shapes/` の形は、その制限の付く前の v24.7.5 (2024-07。`shapes/` もリポジトリ全体の Apache License 2.0 だけ) から移し、v24.7.5 の描画の仕方にそろえています (v24.7.5 より後に追加された形は入れていません)。
`fetchStencils` (コマンドは `--fetch-drawio-stencils`) で取得する図形ライブラリと画像も、既定では v24.7.5 のもので、そのライセンスは Creative Commons Attribution 4.0 (CC BY 4.0) です。
`stencils` (コマンドは `--drawio-stencils`) で自分で渡す図形ライブラリ・画像や、`fetchStencils` の URL (コマンドは `--drawio-stencils-url`) で別のバージョンから取得するものには、そのバージョンの LICENSE がかかります。

`fetchStencils` を付けない (既定の) ときは、図形ライブラリと配布物の画像をネットワークから取得しません (図形ライブラリの要る形は、文字だけ描画して警告します)。

取得した図形ライブラリ・画像のアイコンが入った PDF を人に配る・公開するときは、CC BY 4.0 の表示の条件 (3 項) に従って、クレジットを付けてください。
CC BY 4.0 は、媒体と状況に応じた合理的な方法でよいとしているので、例えば奥付や図の注に次のように書きます。

> 図中のアイコンの一部は draw.io (JGraph Ltd) の図形ライブラリ (v24.7.5) を使用しています。CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)

- 外に提供しないとき (自分だけ、組織の中だけで使うなど) は、この条件はかかりません。
- JavaScript で書かれた形 (`src/drawio/drawioJs/`) は、Apache License 2.0 のコード (draw.io の `shapes/*.js` を移したもの) が描画するもので、図形ライブラリのデータではありません。
  そのため、この CC BY 4.0 のクレジットは要らないと考えています。
  ただ、下に書くとおり、draw.io の README は「JGraph の提供するアイコン」を CC BY 4.0 としていて、アイコンを描画する形 (AWS 3D の `mxgraph.aws3d.*` など) はそれに当たると読まれる余地があります。
  そうした形を含む PDF を配る・公開するときは、念のため、上の例と同じクレジットを付けておくと安全です (`fetchStencils` を付けないときも)。
- AWS・Azure・Cisco・Google Cloud などのアイコンは各社の商標でもあり、CC BY 4.0 は商標の使用を許しません (2 項 (b)(2))。それらのアイコンを使うときは、各社のアイコンの利用のガイドラインも確認してください。
- JavaScript で書かれた形 (`src/drawio/drawioJs/`) にも、他社の製品のアイコン・UI のコンポーネントを描画するもの (AWS 3D の `mxgraph.aws3d.*`、Atlassian の Jira の課題の `mxgraph.atlassian.issue`、iOS・Android・Material Design・Bootstrap のコンポーネントの `mxgraph.ios.*`・`mxgraph.android.*`・`mxgraph.gmdl.*`・`mxgraph.bootstrap.*` など) があります。その名前と意匠 (商標を含みます) は各社のもので、Kumiori は各社と関係が無く、描画できることは各社の承認を意味しません。
  draw.io v24.7.5 の README は、draw.io の書いたソースは Apache License 2.0、JGraph の提供するアイコンと図のひな形は CC BY 4.0 で、第三者が元の権利を持つアイコンには別の条件が掛かることがある、としています。Kumiori は `shapes/*.js` をソース (Apache License 2.0) として扱っています (THIRD_PARTY_NOTICES.md の 13 節)。
  これらの形を含む PDF を配る・公開するときも、各社の商標・ブランドの使い方のガイドラインを確認してください。
- この節は、ライセンスの解釈や法的な判断を示すものではありません。

draw.io と mxGraph から移したソースの一覧・著作権表示・移したバージョンは、[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) の 13 節にあります。
