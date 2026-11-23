# 分綴の言語を増やす設計の覚え書き

状態: 作った (2026-11-22。作る段の 7 回のコミットで main に入れた。9 の決めは、どれも推奨のとおりに決まった)。
作る段で、設計と変えた所:
- 画面のビルド (`dist/`) は、すべてのコードを縮めていて、チャンクごとに外す設定が無いので、ハンガリー語のチャンクも縮まる。
  そのチャンクの先頭に、ソースの形の入手先 (npm の kumiori の `dist-browser/chunks/hu-*.js` と、hyphen の `patterns/hu.js`) を告知する (MPL 1.1 §3.2・§3.6)。
  ブラウザ向けの配布物 (npm) では、決めのとおり縮めない。
- XSL-FO の `script` 属性は、いままでどおり規則の選び分けに使わない (セルビア語の文字は `xml:lang="sr-Latn"` のように書く)。
この覚え書きは、リリースする文書 (`docs/` など) ではありません。

いまの作り (2026-11-22 の main、d98a199):

- `src/hyphenation.ts` の `LOADERS` は、`en-us`・`en-gb`・`la`・`ru`・`uk`・`el` (`hyphen/el-monoton`) の 6 つ。
  ほかの言語は、`hyphens: auto`・`hyphenate="true"` でも分綴しない (CSS Text 3 §5.3。言語が分かっていて、その言語に合う分綴の資源があるときだけ自動で分綴する)。
- 規則は、文書が分綴を使い (`hyphens: auto` がある・`hyphenate="true"` がある)、その言語が文書に出てくるときだけ読み込む
  (`loadDocumentHyphenators`・`src/compat.ts` の `loadFoHyphenators`)。組版は同期なので、組む前に読み込んでおく。
- 依存の `hyphen` (1.14.1、ISC) には、hyph-utf8 (TeX の分綴パターン) を JavaScript に変換した 80 ほどの言語のパターンがある。
  パターンのライセンスは、言語ごとに上流の hyph-utf8 のファイルの冒頭に書いてあり、npm の hyphen の `patterns/*.js` には入っていない。
- 配る物: ブラウザ向けの配布物 (`dist-browser/`) と画面 (`dist/`) は、パターンを言語ごとの別ファイル (`chunks/en-us-….js` など) に取り込み、
  その先頭に、`vite.config.ts` の `HYPHEN_NOTICES` の、そのパターンの著作権とライセンスの表示を入れる。`HYPHEN_NOTICES` に無いパターンを取り込むと、ビルドが誤りで止まる。
  上流の冒頭の表示の写しは `THIRD_PARTY_NOTICES.md` の 1.4 節。
- Node のライブラリ (`dist-lib/`) とコマンド (`dist-cli/`) は `hyphen` を取り込まない (依存のまま。`vite.lib.config.ts` の `external`、
  コマンドは `ssr` のビルド)。パターンは利用者の `node_modules/hyphen` から読むので、Kumiori はパターンを配らない。

---

## 1. 足す言語の案

### 1.1 hyphen にある言語と、上流のライセンス・大きさ

上流のライセンスは、hyph-utf8 (github.com/hyphenation/tex-hyphen の master、2026-11-22 に取得) の `hyph-<名前>.tex` の冒頭の `licence:` を読んだもの。
大きさは hyphen 1.14.1 の `patterns/<名前>.js` (バイト)。gzip は `gzip -9`。いまのビルドはパターンのチャンクを縮めない (minify しない) ので、
チャンクの大きさは、ほぼ生の大きさに表示の分を足したもの (いまの `chunks/en-us-….js` は 114,752 バイト、生は 101,230 バイト)。

ラテン文字の、欧州の主な言語 (ライセンスで分けた):

| hyphen の名前 | 言語 | 上流のライセンス | 選ぶライセンス | 生 | gzip | 推奨 |
|---|---|---|---|---:|---:|---|
| `de-1996` | ドイツ語 (新正書法) | MIT | MIT | 746,424 | 141,252 | 入れる |
| `de-1901` | ドイツ語 (旧正書法) | MIT | MIT | 747,694 | 141,371 | 入れる (9.2) |
| `de-ch-1901` | ドイツ語 (スイス、旧正書法) | MIT | MIT | 735,615 | 138,939 | 入れる (9.2) |
| `fr` | フランス語 | MIT | MIT | 36,991 | 5,681 | 入れる |
| `es` | スペイン語 | MIT | MIT | 133,524 | 11,190 | 入れる |
| `it` | イタリア語 | LPPL 1.3+ か MIT | MIT | 7,433 | 1,362 | 入れる |
| `pt` | ポルトガル語 | BSD 3 条項 | BSD 3 条項 | 6,612 | 1,058 | 入れる |
| `nl` | オランダ語 | MIT | MIT | 232,680 | 46,307 | 入れる |
| `pl` | ポーランド語 | MIT か、TeX の作者の条件の public domain | MIT | 95,633 | 10,525 | 入れる |
| `da` | デンマーク語 | LPPL 1.3+ か MIT | MIT | 18,495 | 4,395 | 入れる |
| `nb` | ノルウェー語 (ブークモール。`nn`・`no` も同じパターン) | 著作権の表示を残せば複製・配布してよい (en-us と同じ文) | その表示 | 571,064 | 109,912 | 入れる |
| `sk` | スロバキア語 | MIT | MIT | 53,538 | 8,562 | 入れる |
| `sl` | スロベニア語 | LPPL 1+ か MIT | MIT | 18,656 | 4,314 | 入れる |
| `et` | エストニア語 | MIT か LPPL 1.3 | MIT | 70,515 | 14,060 | 入れる |
| `lt` | リトアニア語 | MIT | MIT | 24,153 | 4,520 | 入れる |
| `ga` | アイルランド語 | GPL 2+ か MIT | MIT | 122,967 | 24,711 | 入れる |
| `cy` | ウェールズ語 | LPPL 1+ か MIT | MIT | 127,240 | 24,360 | 入れる (2.4 の字の注意) |
| `gl` | ガリシア語 | Unlicense | Unlicense | 72,950 | 6,241 | 入れる |
| `eu` | バスク語 | 許諾の表示 (「Data Files」。表示を残す) | その表示 | 2,374 | 509 | 入れる |
| `hr` | クロアチア語 | LPPL 1+ か、許諾の表示 (「Data Files」。表示を残し、変えたことを書く) | 許諾の表示 | 17,175 | 1,455 | 入れる |
| `sv` | スウェーデン語 | LPPL 1.2+ だけ | LPPL 1.3c (ru と同じ扱い) | 88,901 | 18,167 | 入れる |
| `ca` | カタルーニャ語 | LPPL 1+ だけ | LPPL 1.3c | 14,494 | 1,722 | 入れる (2.4 の l·l の注意) |
| `is` | アイスランド語 | LPPL 1.2+ だけ | LPPL 1.3c | 74,238 | 15,841 | 入れる |
| `tr` | トルコ語 | LPPL 1+ だけ | LPPL 1.3c | 9,045 | 714 | 入れる |
| `sh-latn` | セルビア・クロアチア語 (ラテン文字) | LPPL 1+ だけ | LPPL 1.3c | 56,181 | 6,994 | 入れる (セルビア語のラテン文字に使う) |
| `fi` | フィンランド語 | 「自由に配ってよい」とだけある | その表示 | 5,079 | 1,204 | 入れる (9.3) |
| `hu` | ハンガリー語 | MPL 1.1・GPL 2・LGPL 2.1 のどれか | MPL 1.1 | 1,228,408 | 213,524 | 入れる (9.1) |
| `cs` | チェコ語 | GPL 2+ だけ | — | 62,506 | 12,504 | 入れない |
| `lv` | ラトビア語 | LGPL 2.1 か GPL 2+ | — | 176,554 | 19,269 | 入れない |
| `ro` | ルーマニア語 | 表示が無い (`text: [None]`) | — | 12,142 | 2,916 | 入れない |
| `id` | インドネシア語 | GPL 2 だけ | — | 4,143 | 1,012 | 入れない |

キリル文字の言語 (いまの ru・uk のほか):

| hyphen の名前 | 言語 | 上流のライセンス | 選ぶライセンス | 生 | gzip | 推奨 |
|---|---|---|---|---:|---:|---|
| `sh-cyrl` | セルビア・クロアチア語 (キリル文字) | LPPL 1+ だけ | LPPL 1.3c | 59,121 | 7,225 | 入れる (セルビア語のキリル文字に使う) |
| `bg` | ブルガリア語 | 許諾の表示 (BSD 3 条項に近い。表示を残し、作者の名前を宣伝に使わない) | その表示 | 129,534 | 6,804 | 入れる |
| `sr-cyrl` | セルビア語 (キリル文字) | GPL だけ | — | 55,534 | 7,393 | 入れない (`sh-cyrl` を使う) |
| `mk` | マケドニア語 | GPL だけ | — | 11,335 | 2,426 | 入れない |
| `be` | ベラルーシ語 | MIT | — | 61,145 | 3,351 | この束では入れない (試したら `ін-фа-р-ма-цыя` と 1 字の切れ目が出る。確かめてから別に) |

この束で入れないほかの言語: インド系の文字の言語 (`hi`・`bn`・`ta` など。パターンは 1〜2KB の、字のつながりだけの規則で、語の字の決め方 (inlineLayout の `isLetter`) も別に要る)、
`th` (タイ語は分綴でなく、辞書で語に分ける話で、改行は別に扱っている)、`grc`・`el-polyton` (いまも入れていない)、`la-x-classic`・`la-x-liturgic`・`fi-x-school`・
`mn-cyrl`・`hy`・`ka`・`af`・`oc`・`rm`・`fur`・`pms`・`ia`・`kmr`・`tk`・`hsb`・`cop`・`cu`・`pi`・`sa`・`mul-ethi`・`zh-latn-pinyin` (使う人が少ないか、確かめる手間が大きい。頼まれたら足す)。

### 1.2 Kumiori (Apache-2.0) で配ってよいか

配るのは、ブラウザ向けの配布物と画面の、パターンのチャンクだけ (Node のライブラリとコマンドは、パターンを配らない。前提の節)。
チャンクは、Kumiori のコード (Apache-2.0) と別のファイルで、それぞれが自分のライセンスに従う「まとめた物」の一部として配る。

- **MIT・BSD 3 条項・Unlicense・許諾の表示 (en-us・nb・eu・hr・bg・fi)**: 表示を残せば配ってよい。いまの en-gb・la・uk・el と同じに、
  チャンクの先頭に著作権の表示と許諾の全文を入れる。hr の許諾の表示 (「Data Files」) は、変えたファイルに変えたことを目立つように書くことを求める
  (JavaScript に変換したことを書く。ru の注記と同じ書き方)。bg・pt は、作者の名前を宣伝に使わない条項がある (BSD と同じ。守るのは使い方の側)。
- **2 つ以上から選べるもの (it・da・sl・et・ga・cy・pl・la・uk・el)**: MIT を選び、「MIT を選んで配る」と書く (いまの la・uk・el と同じ)。
- **LPPL だけのもの (sv・ca・is・tr・sh-latn・sh-cyrl)**: いまの ru と同じに、LPPL 1.3c (上流は「1.x 以降」) を選び、
  第 6 項の、変えた物を配る条件 (b: 変えた中身を目立つように書く、c: 元の作者がサポートするように見せない、d: 元のファイルの手に入れ方を書く) の注記を、
  チャンクの先頭に入れる。a (TeX の上で元の部品の代わりに使える物は、別の名前にする) は、JavaScript のデータは元の部品の代わりにならないので当たらない。
  LPPL 1.0 (ca・tr・sh-*) も「or later」なので 1.3c を選べる。
- **MPL 1.1 (hu)**: ファイル単位のコピーレフトで、Apache-2.0 の物とまとめて配ってよい (MPL 1.1 §3.7 の Larger Works)。求められること:
  そのファイルを MPL 1.1 のまま配る (§3.1)、そのファイルのソースの形を手に入れられるようにする (§3.2)、変えたことを書く (§3.3)、
  ライセンスの全文を付ける (§3.1・§3.6)。チャンクを縮めなければ、チャンクそのものがソースの形 (hyphen が変換した JavaScript) で、
  元の `hyph-hu.tex` の手に入れ方を書けば足りる。全文の写しが要るので、`THIRD_PARTY_NOTICES.md` に MPL 1.1 の全文を足す (約 25KB)。hu は入れ、チャンクは縮めない (9.1 で決まった)。
- **入れないもの**: GPL だけ (cs・id・mk・sr-cyrl)・LGPL か GPL だけ (lv) は、Apache-2.0 の配布物に入れると、まとめた物を GPL・LGPL で配る話になるので入れない。
  ro はライセンスの表示が無く、配ってよいと言えないので入れない。
  Node の側も、GPL のパターンを同じプロセスで読み込むのは、結び付けた物と見られうるので、ブラウザと同じく読まない (言語の一覧を 1 つにする)。
- **fi** の「自由に配ってよい」は、変えることについて書いていない。JavaScript への変換は、パターンの中身を変えない形の変換で、
  上流 (hyph-utf8) 自身も、元のファイルを UTF-8 に変換した物をこの表示のまま配っている。入れる (9.3 で決まった)。

ビルドで、許した言語の外のパターンが入らないことは、いまの `HYPHEN_NOTICES` の作り (注記の無いパターンを取り込むとビルドを止める) で守られる。
加えて、hyphen の別名の入口 (`hyphen/sr` は GPL の `sr-cyrl`、`hyphen/sh` は `sh-cyrl`、`hyphen/de` は `de-1996`) は使わず、
`LOADERS` には `hyphen/<パターンの名前>/index.js` を書く (試験で、`LOADERS` の名前が `HYPHEN_NOTICES` の名前と同じで、入れない名前を含まないことを確かめる)。

### 1.3 THIRD_PARTY_NOTICES.md に足すもの

- 1.4 節の見出しと初めの段落の、読み込むパターンの一覧を直す (「英語・ラテン語・…」を、言語の一覧にする)。
- 足すパターンごとに、いまの言語と同じ形で、上流の `hyph-<名前>.tex` の冒頭の表示 (パターンの前のコメントすべて) を写す。
  取得元の URL と取得日と、hyphen 1.14.1 のパターンが上流のどの版から変換されたかは確かめていないこと (いまと同じ文) も書く。
  写す行の数は、言語によって 20〜170 行ほど (de は作者の一覧と MIT の全文で 60 行ほど)。
- MPL 1.1 の全文 (hu を入れるとき)。LPPL 1.3c は、いまの ru と同じく URL を書き、全文は写さない (いまの扱いに合わせる)。
  BSD 3 条項・Unlicense は、上流の冒頭の表示に全文があるので、その写しで足りる。
- `test/thirdPartyNotices.test.ts` に、`LOADERS` の言語ごとに 1.4 節に節があることを確かめる試験を足す (いまの試験の作りを見て、合う所に)。
- `vite.config.ts` の `HYPHEN_NOTICES` に、パターンごとの注記を足す (MIT の物は `MIT_TEXT` を使い回す。LPPL の物は、ru の注記を関数にして使い回す)。
- 2 節 (Node の依存) は直さない (hyphen 1.14.1 は ISC で、もう載っている。パターンを配るのはブラウザ向けの配布物だけ)。

### 1.4 推奨の一覧

**入れる (29 のパターン)**: `de` (`de-1996`・`de-1901`・`de-ch-1901`)・`fr`・`es`・`it`・`pt`・`nl`・`pl`・`da`・`sv`・`nb`/`nn`/`no` (`nb` の 1 つ)・`fi`・`hu`・
`sk`・`sl`・`hr`・`et`・`lt`・`ga`・`cy`・`gl`・`eu`・`ca`・`is`・`tr`・`sr` (`sh-latn`・`sh-cyrl`)・`bg`。

**入れない**: `cs`・`id`・`mk`・`sr-cyrl` (GPL)・`lv` (LGPL か GPL)・`ro` (ライセンスの表示が無い)。`be` と 1.1 の終わりに挙げた言語は、この束では入れない。

チェコ語は使う人が多いので、入れられないことを `docs/features.md` などに書く (自分のパターンを渡す API は、作らない。9.6 で決まった)。

---

## 2. 言語の対応付け

### 2.1 決まり

言語のタグ (HTML の `lang`・`xml:lang`、XSL-FO の `xml:lang`・`language` と `country`・`script`) から、パターンの名前を 1 つ選ぶ。
タグは BCP 47 (RFC 5646) として読み、RFC 4647 §3.4 の lookup と同じに、後ろの部分を外しながら表の名前と照らす。

1. 小文字にし、`_` を `-` にする。`x-` から後ろ (私用)、拡張 (`-u-`・`-t-` など、1 字の部分の後ろ) は外す。
2. 初めの部分 (言語) が 3 字の ISO 639-2 の符号なら、2 字に直す (XSL 1.1 §7.10 の `language` は ISO 639-2 でもよい)。
   `src/pdfRenderer.ts` の `ISO639_2_TO_1` (書誌用 B と用語用 T の両方) を共に使う所 (`src/languageTag.ts` など) に移し、足す言語の符号を足す
   (`cat`→ca・`slk`/`slo`→sk・`slv`→sl・`hrv`→hr・`est`→et・`lit`→lt・`gle`→ga・`cym`/`wel`→cy・`glg`→gl・`eus`/`baq`→eu・`isl`/`ice`→is・`hun`→hu・
   `srp`→sr・`bul`→bg・`nob`→nb・`nno`→nn・`lat`→la・`ukr`→uk)。
   いまは `keyOf` がこれをしないので、`language="eng"`・`"rus"` の XSL-FO は分綴しない (いまの欠け。この束で一緒に直す。8 の 1 の段)。
3. 言語ごとの決まり:
   - `en`: いまと同じ (`en-GB` だけ `en-gb`、ほかは `en-us`)。
   - `de`: 異形 (variant) の `1901` があれば、地域が `CH`・`LI` なら `de-ch-1901`、ほかは `de-1901`。異形が `1996` か、無ければ `de-1996`
     (スイスの新正書法 `de-CH` も `de-1996`。hyph-utf8 にスイスの新正書法の物は無く、TeX の babel もスイスの新正書法には新正書法のパターンを使う)。
     `gsw` (スイスドイツ語) は別の言語なので当てない。
   - `pt`: `pt-BR`・`pt-PT` とも `pt` (hyph-utf8 のポルトガル語は 1 つ)。`es`・`fr`・`nl`・`sv`・`it` も地域によらず 1 つ。
   - `nb`・`nn`・`no` (と、古い登録のタグ `no-bok`・`no-nyn`): どれも `nb` (hyphen の `nb`・`nn`・`no` のパターンは、並びが違うだけで同じ中身。2026-11-22 に比べた)。
   - `sr`: 文字の部分 (script) が `Latn` なら `sh-latn`、`Cyrl` なら `sh-cyrl`。無ければ、地域が `ME` なら `sh-latn`、ほかは `sh-cyrl`
     (CLDR の likely subtags で、`sr` は `sr-Cyrl-RS`、`sr-ME` は `sr-Latn-ME`)。XSL-FO の `script` (`Latn`・`Cyrl`。XSL 1.1 §7.10) も見る。
     `sh` (古いセルビア・クロアチア語のタグ) は、文字の部分が `Cyrl` なら `sh-cyrl`、ほかは `sh-latn`。`hr`・`bs` は `hr` (bs はこの束では当てない。9.5)。
   - `el`: いまと同じ (`-polyton` があれば当てない)。
   - ほかは、初めの部分がそのまま表の名前 (`fr`・`pl` など)。
4. **文字の部分が、パターンの文字と違えば当てない** (`ru-Latn`・`de-Cyrl` など。パターンはその文字の綴りの規則なので)。ラテン文字のパターンに `Latn`、
   キリル文字のパターンに `Cyrl` を表に持たせる。
5. 当たる物が無ければ分綴しない (いまと同じ)。

いまの `keyOf` の、言語の指定が無いときは英語にする決まり (文書の根の要素に `lang` が無いときと、XSL-FO の `language` が無いとき) は変えない。
`lang=""` (言語が分からない) を英語として扱うことも、この束では変えない (変えると英語の文書が広く変わる。別の項目にする)。

### 2.2 CSS Text 3 §5.3 との関係

§5.3 は、`hyphens: auto` で自動に分綴するのは、文の言語が分かっていて、その言語に合う分綴の資源があるときだけ、とする。

- 2.1 の 5 で、資源の無い言語 (cs・ro など) は分綴しない。近い言語の規則を当てない (cs に sk を当てない。`de-1901` に新正書法を当てない。
  sr-Cyrl に GPL の `sr-cyrl` の代わりの `sh-cyrl` を当てるのは、同じ言語・同じ文字の規則なので当てる)。
- 言語を知らせるのは要素の言語 (HTML の `lang`、XML の `xml:lang`。CSS の `:lang()` と同じ物) で、いまと同じ。
- `hyphens: manual` の `&shy;` は、言語によらず使う (いまと同じ)。

XSL-FO の `hyphenate="true"` (XSL 1.1 §7.10) も同じ表で選ぶ (`loadFoHyphenators` と組版の両方が、同じ `keyOf` を通る)。

### 2.3 分ける字の最小の数 (hyphenmins)

TeX のパターンは、言語ごとに、語の初めと終わりに残す字の最小の数 (`lefthyphenmin`・`righthyphenmin`) を決めて作ってある (上流の冒頭の `hyphenmins: typesetting:`)。
いまは、どの言語でも前後 2 字以上 (`hyphenPositions` の作り) で、`hyphenate-limit-chars` (CSS Text 4) と
`hyphenation-push-character-count`・`hyphenation-remain-character-count` (XSL 1.1 §7.10) で変えられる。

上流の値は、足す言語のほとんどが 2・2 で、2・3 は `pt`・`sk`・`ga`・`cy`・`et`。`af` は 1・2 (入れない)。`de-*` は終わりだけ 2 (初めは TeX の既定の 2)。
案: 足す言語では、`hyphenate-limit-chars` の `auto` (と XSL-FO で指定の無いとき) に、上流の値を使う (CSS Text 4 は、auto を UA が言語に合わせて決めてよいとする)。
いまの言語 (en-us は 2・3、en-gb は 2・3) の値は変えない (変えると英語の文書が広く変わる)。この案に決まった (9.4)。

### 2.4 語の字

`src/inlineLayout.ts` の `isLetter` は、ラテン文字の語の字を `[A-Za-zÀ-ɏ]` (Latin-1 補助と、ラテン拡張 A・B) にしている。
足すラテン文字の言語の字は、ほとんどこの中にある (ł・ő・ř・ș・ț・ŀ など)。足りない・合わない物:

- **ウェールズ語**の `ẁ`・`ẃ`・`ẅ`・`ỳ` (ラテン拡張追加 U+1E00〜U+1EFF)。cy のときだけ、語の字に U+1E00〜U+1EFF を足す (`hyphenationLetters` に、ラテン文字の追加の字を返す形を足す)。
- **カタルーニャ語**の `l·l` (U+00B7 の中黒): `col·lecció` は、いまの語の分け方では `col` と `lecció` の 2 語になる。
  hyphen に `col·lecció` を渡すと `col·-lec-ció` と、中黒の後で分けるが、カタルーニャ語の正しい分け方は `col-lecció` (中黒を外してハイフン) で、
  分けたときに字が変わるので、パターンだけでは組めない。この束では、中黒を語の字にしない (いまのとおり、`l·l` の所では分けない) ことにして、試験で確かめる。
- フランス語・イタリア語の省略符 (`l'organisation`・`l’homme`): 省略符は語の字でないので、`organisation` だけが語になり、正しく分かれる (試したら `or-ga-ni-sa-tion`)。
- キリル文字の `bg`・`sh-cyrl` は、`hyphenationLetters` でキリル文字を語の字にする (いまの ru・uk と同じ)。セルビア語の `ђ`・`ј`・`љ`・`њ`・`ћ`・`џ` も U+0400〜U+045F の中。

---

## 3. 読み込み

### 3.1 必要なときだけ読む

いまの作り (`loadHyphenator` が `LOADERS` の `import()` を呼ぶ。読んだ物は覚えておく) を変えない。`LOADERS` に言語を足すだけで、
文書が分綴を使い、その言語が出てくるときだけ読む。同じパターンを指す名前 (`nb`・`nn`・`no`) は、1 つの読み込みにまとめる (覚えておく名前をパターンの名前にする)。

### 3.2 kumiori/browser の大きさ

ブラウザ向けの配布物 `dist-browser/kumiori.js` は、パターンを取り込まない (`import()` の先は別のチャンクになる。いまも `chunks/en-us-….js` などが別)。
`kumiori.js` が増えるのは、`LOADERS` の表と対応付けの表の分 (数 KB) だけ。2026-11-22 の main で `kumiori.js` は 3,229,939 バイト (gzip 1,042,861)、
`dist-browser/` の全体は 6,531,737 バイト。

測る方法 (作る段の終わりに、前と後を比べて、コミットの文と報告に書く):

1. `npm run build:browser` の後、`kumiori.js` の大きさと、`chunks/` の、パターンのチャンクの名前と大きさを並べる。
2. `kumiori.js` にパターンが入っていないことを確かめる (パターンのチャンクの先頭の注記 `Hyphenation patterns for` が `kumiori.js` に無い)。
   この確かめは、試験にする案もある (ビルドの後に走る試験は今は無いので、`scripts/` の確かめに足すか、作る段で決める)。
3. 画面のビルド (`npm run build`) の `dist/assets/` でも同じに並べる。

### 3.3 npm の配る物の大きさ

`dist-browser/` は npm の配る物 (`package.json` の `files`) に入るので、パターンのチャンクの分だけ増える。
推奨の一覧 (1.4) の生の大きさの合計は約 5.5MB (`de-*` の 3 つで 2.2MB、`hu` 1.2MB、`nb` 0.57MB、`nl` 0.23MB、残りの 23 で 1.25MB ほど)。
gzip の合計は約 1.0MB で、npm の包み (tgz) はおおよそこの分増え、展開した大きさは約 5.5MB 増える (いまの `dist-browser/` の 6.5MB に近い)。

減らす案: **パターンのチャンクだけを縮める** (空白を除く)。`de-1996` は 745KB → 283KB、`hu` は 1.2MB → 468KB、`nb` は 570KB → 234KB になり (試した)、
合計は 5.5MB → 2.2MB ほど。注記は `/*!` で始めているので、縮めても残る。縮め方は、rolldown の出力の `minify` をパターンのチャンクだけに当てられるか、
`renderChunk` で縮めるかを作る段で確かめる (`kumiori.js` の縮め方は変えない)。**縮める** (9.2 で決まった)。

**hu (MPL 1.1) だけは縮めない** (9.1 で決まった)。MPL 1.1 では、ソースの形 (§1.11。手を入れるのに向いた形) でない物は実行の形 (§1.5) の扱いになり、
実行の形で配るなら、ソースの形を電子的な手段で 12 か月以上手に入れられるようにし (§3.2)、その手に入れ方を告知する (§3.6) ことが要る。
空白を除いて 1 行にした物は、手を入れるのに向いた形と言い切れないので、hu のチャンクは縮めずに、そのものをソースの形として配る
(hyphen が変換した JavaScript のまま。元の `hyph-hu.tex` の手に入れ方も注記に書く)。縮めない hu を足すと、合計は 2.2MB → 約 3.0MB。

Node のライブラリとコマンドの配る物 (`dist-lib/`・`dist-cli/`) は、パターンを取り込まないので増えない。利用者の `node_modules/hyphen` には、もともと全部の言語がある。

---

## 4. 組版の結果

変わるのは、足した言語で分綴を使う文書 (`hyphens: auto`、`hyphenate="true"`) の、その言語の所だけ。

- いまの言語 (en・la・ru・uk・el) の分綴は変えない。ただし、2.1 の 2 で `language="eng"` などの 3 字の符号の XSL-FO を分綴するようになるので、
  そういう文書は変わる (いまの欠けを直す変化)。
- リポジトリの文書 (`docs/conformance/` の 4 冊) は、分綴を使い、足す言語を使っていないので、分綴は変わらない。
  ただし、4 冊の「対応している言語と文字」の節の文を直すので (8 の 4 の段)、その文の所は変わる (領域の木の指紋も変わる)。

前と後の組み比べ (`npm run compare:base -- --base <直す前のコミット> --head .`):

- 見本 (アンテナハウスのサンプル FO 集など) のうち、`hyphenate="true"` でドイツ語・フランス語などを使う物があれば変わる。変わった文書とページが、
  足した言語の所だけかを確かめる。
- 言語ごとの短い試験の文書を、`test/` の下 (たとえば `test/fixtures/hyphenation-languages.html` と `.fo`) に作る。
  文は、自分で書いた短い文 (その言語の普通の語を並べたもの。他の人の文を写さない) を、狭い段に `hyphens: auto` で組む。
  言語ごとに 1 つの段落 (`lang` を変える)。XSL-FO の版は `language`・`country` (`de` + `CH`、`pt` + `BR`) と 3 字の符号 (`deu`) も使う。
  この文書を前と後で組み、ハイフンの位置を目で確かめる (比べる道具の `--extra` のような、追加の文書を渡す選択肢があるかを作る段で確かめ、無ければ、
  `node dist-cli/cli.js` で前と後を組んで `scripts/compare-pdf.mjs` で比べる)。

---

## 5. 試験の案

`test/hyphenation.test.ts` に足す (いまの ru・uk・el の試験と同じ形):

- **分綴の位置**: 言語ごとに 2〜3 語 (普通の語。hyphen 1.14.1 で試した結果):
  `Sil-ben-tren-nung`・`Do-nau-dampf-schiff-fahrt` (de)・`Stras-se` (de-CH-1901)・`hy-phé-na-tion`・`dé-ve-lop-pe-ment` (fr)・`in-for-ma-ción`・`de-sa-rro-llo` (es)・
  `in-for-ma-zio-ne`・`svi-lup-po` (it)・`in-for-ma-ção`・`de-sen-vol-vi-men-to` (pt)・`woord-af-bre-king`・`ont-wik-ke-ling` (nl)・`przed-się-bior-stwo` (pl)・
  `ud-vik-ling` (da)・`ut-veck-ling` (sv)・`ut-vik-ling` (nb・nn・no)・`tie-to-ko-ne` (fi)・`fej-lesz-tés` (hu)・`in-for-má-cia` (sk)・`in-for-ma-ci-ja` (sl・hr・lt)・
  `in-for-mat-sioon` (et)・`bil-gi-sa-yar`・`ge-liş-tir-me` (tr)・`upp-lýs-ing-ar` (is)・`eol-aí-ocht` (ga)・`gwybod-aeth` (cy)・`in-for-ma-ció` (ca)・`in-for-ma-ción` (gl)・
  `in-for-ma-zioa` (eu)・`ин-фор-ма-ци-ја` (sr・sr-Cyrl)・`in-for-ma-ci-ja` (sr-Latn)・`ин-фор-ма-ция` (bg)。
  作る段で、言語の辞書と照らして、おかしな物 (`in-for-ma-zioa` の `zioa` など) を、別の語に換える。2.3 を入れるなら、2・3 の言語で終わりの 2 字では分けないことも。
- **対応付け**: 2.1 の決まりを、表で試す: `de-1901`→de-1901、`de-CH`→de-1996、`de-CH-1901`・`de-LI-1901`→de-ch-1901、`de-AT`→de-1996、`pt-BR`・`pt-PT`→pt、
  `nb`・`nn`・`no`・`no-bok`→nb、`sr`・`sr-RS`・`sr-Cyrl`→sh-cyrl、`sr-Latn`・`sr-ME`→sh-latn、`deu`・`ger`・`fre`・`eng`→de・de・fr・en-us、
  `de-x-foo`・`fr-u-nu-latn`→そのまま、`ru-Latn`・`de-Cyrl`→無し、`cs`・`ro`・`lv`・`id`・`mk`→無し、`gsw`→無し。
  対応付けの関数を試験から呼べるように、`src/hyphenation.ts` から出す (`hyphenationKey` などの名前。公開の API には出さない)。
- **入れない名前を読まない**: `LOADERS` の名前が `HYPHEN_NOTICES` の名前と同じで、`cs`・`id`・`mk`・`sr-cyrl`・`lv`・`ro` を含まないこと。
  (`HYPHEN_NOTICES` は `vite.config.ts` の中なので、表を `src/hyphenationNotices.ts` などに移して両方から読むか、試験でファイルを読んで照らすかを作る段で決める。)
- **語の字**: `bg`・`sr-Cyrl` でキリル文字の語を分け、`cs` の文のキリル文字・ラテン文字は分けない。cy の `ŵ`・`ẃ` を含む語が 1 語になる。ca の `col·lecció` を `l·l` で分けない。
- **組版**: いまの「狭い箱で、語の途中にハイフンを付けて折り返す」の試験に、`de`・`fr`・`pl`・`sr-Latn` を足す。XSL-FO で `language="deu" country="CH"` と `language="eng"` を組む試験
  (`loadFoHyphenators` が規則を読み、組んだ行にハイフンが付く)。
- **注記**: `test/thirdPartyNotices.test.ts` で、`LOADERS` のパターンごとに `THIRD_PARTY_NOTICES.md` の 1.4 節の節があること。

---

## 6. 大きさの見積もり

- `src/hyphenation.ts`: `LOADERS` に 29 行、対応付けを表と関数に直して 80 行ほど、語の字に 10 行ほど。
- `src/languageTag.ts` (新しく。3 字の符号の表を `src/pdfRenderer.ts` から移す): 40 行ほど。
- `vite.config.ts` の `HYPHEN_NOTICES`: 1 つの言語に 4〜15 行で、350 行ほど (表を別のファイルに移すかは作る段で)。チャンクを縮めるなら 20〜40 行。
- `THIRD_PARTY_NOTICES.md`: 上流の冒頭の表示の写しで 2,000 行ほど (言語ごとに 20〜170 行)、MPL 1.1 の全文で 470 行ほど。
- 試験: 200〜300 行。試験の文書 (HTML と FO): 150 行ほど。
- 文書: `docs/features.md`・`docs/html-css-plan.md`・`docs/xslfo-import.md` (日英)、`docs/conformance/` の 4 冊の「対応している言語と文字」、CHANGELOG (日英)。

大きさは「中」。手間の多くは、上流の表示を写して確かめること。

---

## 7. ぶつかる所

- 同じ波の束 L1 (`src/hyphenation.ts` の `rejoin(thisCall(), …)`。呼び出しの文脈を await の後で置き直す) は main に入っている。`loadHyphenator` の作りはそのまま使う。
- `src/pdfRenderer.ts` の `ISO639_2_TO_1` を移すと、SVG の `systemLanguage` の照らし (`svgLanguageTag`) も新しい所から読む。表に足す符号は、`svgLanguageTag` の結果も変える
  (`hun` などの 3 字の符号の言語が、SVG の `systemLanguage="hu"` と合うようになる。いまの欠けを直す変化)。

---

## 8. 作る段 (コミットの分け方)

1. **対応付けを作り直す**: 2.1 の決まり (3 字の符号・異形・文字・地域) を表と関数にし、`src/languageTag.ts` に 3 字の符号の表を移す。いまの 6 つのパターンのまま。
   試験 (対応付けの表、`language="eng"` の XSL-FO)。組み比べ: 3 字の符号の XSL-FO の文書だけが変わることを確かめる。
2. **許諾の緩いパターンを足す** (MIT・BSD・Unlicense・許諾の表示): de×3・fr・es・it・pt・nl・pl・da・nb・sk・sl・hr・et・lt・ga・cy・gl・eu・bg・fi。
   `HYPHEN_NOTICES`・`THIRD_PARTY_NOTICES.md` の 1.4 節・語の字 (cy・bg)・試験。
3. **LPPL だけのパターンを足す**: sv・ca・is・tr・sh-latn・sh-cyrl。ru の注記を関数にして使い回す。`THIRD_PARTY_NOTICES.md`・試験。
4. **hu を足す**: MPL 1.1 の注記と、`THIRD_PARTY_NOTICES.md` に MPL 1.1 の全文。
5. **大きさ**: パターンのチャンクを縮める (hu は縮めない。3.3)。`npm run build:browser`・`npm run build` で前と後の大きさを測り、`npm pack --dry-run` の大きさも並べる。
   試験かビルドの確かめで、hu のチャンクが縮められていないこと (改行が残っていること) を確かめる。
6. **言語ごとの hyphenmins**: 足す言語だけ、上流の値を auto の値にする (2.3)。
7. **文書**: `docs/features.md`・`docs/html-css-plan.md`・`docs/xslfo-import.md` (日英)、`docs/conformance/` の 4 冊、CHANGELOG (日英)。
   4 冊の指紋が変わるので `npm run fingerprints:update` で書き直し、コミットの文に理由を書く。

段ごとに `npm run typecheck`・`npm test` を通し、2・3・4・6 は試験の文書と見本で組み比べる。終わりに、依存は変えないが配る物が大きく変わるので、
main に入れた後に `npm run ci:local -- --worktree` を走らせる (build・pages・e2e)。段の数は 7。

---

## 9. 決めたこと (2026-11-22。利用者が、どれも推奨のとおりに決めた)

利用者は「推奨の 29 のパターンを入れて、パターンのチャンクを縮める」と決めた。項目ごとには次のとおり。設計のときに並べた候補は、決めたものの下に残す。

### 9.1 ハンガリー語 (MPL 1.1): 入れる

MPL 1.1 を選ぶ。`THIRD_PARTY_NOTICES.md` に MPL 1.1 の全文を足す。縮めるかは MPL の決まりに合う形にする、という決めなので、
hu のチャンクだけは縮めない (3.3。縮めると、ソースの形を手に入れられるようにする決まり (§3.2・§3.6) の手当てが要るため)。

(候補だったもの: 入れない / Node だけで読む)

### 9.2 ドイツ語の旧正書法 2 つと、チャンクを縮めるか: 3 つとも入れ、パターンのチャンクを縮める

`de-1996`・`de-1901`・`de-ch-1901` を入れる。hu のほかのパターンのチャンクを縮める。配る物の増えは、生で約 3.0MB (縮めない hu を含む)。

(候補だったもの: 3 つとも入れて縮めない (約 5.5MB) / `de-1996` だけ)

### 9.3 フィンランド語 (「自由に配ってよい」だけの表示): 入れる

表示をそのまま残す。

(候補だったもの: 入れない)

### 9.4 言語ごとの、分ける字の最小の数: 足す言語だけ、上流の hyphenmins を使う

足す言語だけ、上流の hyphenmins を `hyphenate-limit-chars: auto` と、XSL-FO で指定の無いときの値にする (2.3。pt・sk・ga・cy・et は終わり 3 字)。
いまの言語 (en・la・ru・uk・el) の値は変えない。

(候補だったもの: どの言語も前後 2 字 / いまの言語も上流の値にする)

### 9.5 ボスニア語 (`bs`): 当てない

資源の無い言語として、分綴しない。

(候補だったもの: `sh-latn` を当てる)

### 9.6 チェコ語などの GPL のパターン: 入れない

入れられないこと (cs・id・mk と、セルビア語の GPL の物。lv・ro も) を、`docs/features.md` などの文書に書く (8 の 7 の段)。パターンを渡す API は作らない。

(候補だったもの: 利用者がパターンを渡す API をこの束で作る)

### 9.7 ISO 639-2 の 3 字の符号の欠け: 一緒に直す

XSL-FO の `language="eng"`・`"deu"` などで分綴しない、いまの欠けを、8 の 1 の段で一緒に直す (2.1 の 2)。
