# PDF のページを図として貼る設計の覚え書き

状態: 決まった (2026-11-22)。7 節の決めは、利用者がどれも推奨の案に決めた (画面・SVG・PNG は仮の枠と警告にし、pdf.js は入れない)。
作る段は、取りまとめ役の「始めてよい」を待つ。始めるときは、その時点の main から作る段のブランチを作る。
8 節に、pdf-lib (1.17.1) の中を読んで確かめたことを書き、1.3 節・2.1 節・4 節をそれに合わせて直した。

利用者の決め (2026-11-22): `<img src="a.pdf">` と `fo:external-graphic src="url(a.pdf)"` で、PDF のページを図として貼れるようにし、0.6.0 に入れる。

前提にしたもの:

- 同じ版の束 L3 は、PDF を何ページにも流す書き方 (流し書き) をやめ、`maxPages` だけを作る。流し書きは 0.7.0。
  この覚え書きも、1 つの参照で貼るのは **1 ページだけ** にする (7 節の 1)。
- 同じ時期に、束 L7 (同じ入力から同じバイトの PDF・ページラベル) が `src/pdfRenderer.ts` のカタログと日付を触る。
  この設計は、カタログ (OCProperties・StructTreeRoot の根・名前の辞書など) を足さず、画像の埋め込みと描く所だけを変える (2.5 節)。
- 呼び出しごとの文脈 (`src/callContext.ts`) がある。非同期の関数に `await` を足すときは `rejoin(thisCall(), await …)` の形にする。
  pdf-lib を遅れて読み込む所 (`import('pdf-lib')`) も同じ。
- 入力の上限は `src/limits.ts` の表 (`design/limits.md`) で公開している。足す上限は、この表に足す (4 節)。

---

## 1. 入力の形

### 1.1 PDF の見分け方

- **中身で見分ける**。ファイルの頭 `%PDF-` (ISO 32000-1 §7.5.2。ISO 32000-2 も同じ節) を、先頭の 1,024 バイトの中で探す。
  仕様は先頭に置くとするが、前にゴミの付いたファイル (メールの頭・BOM など) が実際にあり、pdf-lib の読み手も頭を探して読む。
  先頭でない所に見つけたときは、読むが、`image/pdf-repaired` (情報) を出す (1.4 節)。
- 名前の拡張子 (`.pdf`) と、取ったときの Content-Type (`application/pdf`)・FO の `content-type="application/pdf"` は手がかりにするだけで、
  中身が `%PDF-` でなければ PDF として読まない (いまの画像と同じ考え方。`assets.ts` の `sniffMime` の説明)。
- 置き場所: 見分ける関数 `isPdf(bytes)` を `src/imageInfo.ts` に足す (CGM の `isCgm` と同じく同期で安く)。
  中身を読む所 (ページを探し、箱・回転を読む) は新しいファイル `src/pdfImage.ts` に置き、PDF が出てきたときだけ `import()` する
  (pdf-lib は PDF の出力でもう読み込んでいるが、画面の配布物では PDF の書き出しを押すまで読まないので、それに合わせる)。
- `looksLikeImage` (`assets.ts`。名前に画像の拡張子の無い中身を画像として拾うか) にも `isPdf` を足す (resolveResource が返した中身・取った中身も PDF として読める)。
- `imageFormats.ts` の受け口 (プラグイン) には載せない。受け口は「SVG にして返す」形で、PDF のページは SVG にしない (ベクタのまま Form XObject にする) ため。
  WMF・EMF・EPS と同じく、本体の `assets.ts` が読む。プラグインの形式は本体の形式より先に判定する決まりなので、
  PDF を見分けるプラグインを利用者が渡したら、そちらが勝つ (7 節の 6)。

### 1.2 ページの選び方

参照の fragment (`#` の後ろ。RFC 3986 §3.5: fragment の意味は資源の形式が決める) で選ぶ。PDF の fragment は RFC 8118 (§3) が決めている。

- **`page=N`** (RFC 8118 §3。1 から数えるページの番号): どのモードでも読む。無ければ 1 ページ目。
  - ページの数を超える・0 以下・数でない値は、RFC 8118 に合わない値として無視し、1 ページ目にして `image/pdf-page` (警告) を出す。
  - RFC 8118 のほかの引数 (`nameddest=`・`zoom=`・`view=`・`viewrect=`・`highlight=`・`comment=`・`search=`・`fdf=`) は、表示の仕方の指定で、
    どのページを図にするかには関わらないので、無視する (警告も出さない。`nameddest=` だけは 7 節の 7)。
  - 引数は `&` でつなぐ (RFC 8118 §3)。XML の中では `&amp;` と書く。
- **アンテナハウスの拡張** (公開の説明書の「PDF の埋め込み」の節による。自分の言葉でまとめる):
  - ページの範囲 `page=3-5`・`page=3-`・`page=all` (範囲のページを続けて貼る) と、
    図の大きさにする箱 `bbox=MediaBox|CropBox|BleedBox|TrimBox|ArtBox` (大文字小文字を問わない。既定は CropBox) がある。
  - どちらも接頭辞の無い名前 (`page`) に足された値・接頭辞の無い引数 (`bbox`) なので、CLAUDE.md の決まりで、**互換の指定 (`--compat antenna`・`--style ah`) のときだけ読む**。
    互換の指定の無いときは、RFC 8118 に無い値・引数として無視し、`image/pdf-fragment` (警告) を出す (範囲は 1 ページ目を貼る)。
  - 互換の指定のときも、0.6.0 では範囲を流さない (L3 の決め)。範囲の **最初のページだけ** を貼り、`image/pdf-page-range` (警告。「範囲の 2 ページ目からは貼りません。流し書きは今後の版」) を出す。
    0.7.0 で、見本の並べ方 (サンプル FO 集の pdf-embedding-2・graphics-pdf-1: 範囲のページを、間を空けずに 1 行に横に並べ、下端をそろえる) に合わせ、
    範囲を 1 つの図 (幅はページの幅の和、高さは最大) にして、PDF の出力でページごとの Form を並べて描くようにした (`pdfImage.ts` の pageImage・`pdfRenderer.ts` の drawPdfForm)。`image/pdf-page-range` は、範囲のページの数が上限 `pdfImageRangePages` を超えたときだけ出す (4 節)。
  - data: の URI では、アンテナハウスはページの番号を media type の引数に書く。これも互換の指定のときだけ読む (作る段で、公開の見本の書き方を確かめてから)。
  - `axf:` の属性・`-ah-` のプロパティで PDF のページ・箱を選ぶものは、公開の説明書には見当たらない (背景の `axf:background-image` に PDF を指すことはでき、
    `axf:background-repeat="paginate"` でページを流す。流すのは 0.7.0。`axf:background-image` に 1 ページを貼るのは、ふつうの画像と同じ道を通るので、この設計で動く)。
- 同じファイルを fragment の違う参照で指すとき (`a.pdf#page=1`・`a.pdf#page=2`) は、参照ごとに別の画像として登録する。
  いまの `AssetStore.addFragment` は本体の外の形式 (`formatSource`) の画像だけを読み直すので、PDF の画像 (`pdfSource`) も読み直せるようにする。
  数の上限は、いまの `formatFragments` (既定 64) をそのまま使う (超えたら `image/too-many-fragments`)。
  PDF を読み解いた結果 (ページの木・相互参照の表) は、元のバイト列ごとに弱い表で覚えて、ページごとに読み直さない (4 節)。

### 1.3 大きさ (箱) と回転

- **既定の箱は CropBox** (無ければ MediaBox)。根拠: ISO 32000-1 §14.11.2 (ページの境界)。CropBox は、表示・印刷のときにページの中身を切り取る範囲で、既定は MediaBox。
  ビューアに見えるページの大きさがこれなので、図の大きさもこれにする (アンテナハウスの既定も CropBox)。
  - 箱は MediaBox と重なる所に切り詰める (§14.11.2: CropBox などは MediaBox の中に切り詰めて使う)。重なりが無い・幅か高さが 0 なら、読めない画像 (`image/pdf-invalid`)。
  - BleedBox・TrimBox・ArtBox は、互換の指定の `bbox=` で選んだときだけ使う。無ければ CropBox (アンテナハウスの説明と同じ。§14.11.2 も、既定は CropBox)。
  - 箱は親のページの木から受け継ぐ (MediaBox・CropBox は受け継ぐ属性。ISO 32000-1 §7.7.3.4、Table 30)。pdf-lib の `PDFPageLeaf` は、Resources・MediaBox・CropBox・Rotate の受け継ぎを解くが、
    親を再帰でたどり、輪を止めない (8 節の 2)。そのため、受け継ぎは Kumiori がページを探すときに、たどった親の並びから解く (段は `pdfImageDepth` で縛る)。
    BleedBox・TrimBox・ArtBox・UserUnit・Group は受け継がない属性なので、ページ自身のものだけを見る。
  - 箱の 4 つの数は、左下と右上の順に並んでいなくてもよい (§7.9.5: 矩形は対角の 2 点)。並べ直して使う。
- **UserUnit** (ISO 32000-1 Table 30。PDF 1.6): あれば、1 単位を UserUnit/72 インチとして大きさを決める (無ければ 1)。
- **大きさは CSS px** (96dpi): 幅 = 箱の幅 × UserUnit × 96/72。画像の解像度 (`image-resolution`) は効かない (ベクタ)。上限は `formatSize` と同じ考え方で、
  有限で `formatSize` 以下 (超えたら `image/invalid-size`)。
- **回転 /Rotate** (ISO 32000-1 Table 30。90 の倍数。表示するときに時計回りに回す。受け継ぐ属性): 90・270 なら幅と高さを入れ替えて図の大きさにし、
  PDF に描くときは、その分を回す行列を掛ける (2.1 節)。90 の倍数でない値は、0 とみなして `image/pdf-invalid` でなく `image/pdf-repaired` (情報) を出す
  (§7.7.3.3 の決まりに合わない値。読めるので捨てない)。負の値・360 以上は 360 で割った余りにする。
- 図の縦横比は箱 (回した後) のもの。`content-width`・`content-height`・`object-fit` などは、いまの画像と同じに効く。

### 1.4 壊れた・暗号化した・入れ子の PDF

| 場合 | 扱い | 診断 |
| --- | --- | --- |
| 頭が先頭に無い・相互参照の表が壊れていて、pdf-lib が直して読めた | 読む | `image/pdf-repaired` (情報) |
| pdf-lib が読めない・ページの木がたどれない・選んだページが無い (ページの数 0) | 読めない画像 (どの出力でも仮の枠) | `image/pdf-invalid` (警告) |
| 暗号化してある (trailer に Encrypt。ISO 32000-1 §7.6) | 読めない画像。空の利用者のパスワードで開けるものも含めて、0.6.0 では解かない (pdf-lib は暗号を解かない。`ignoreEncryption` で読むと、流れと文字列が暗号のまま写る) | `image/pdf-encrypted` (警告) |
| ページの中身・資源の入れ子 (Form XObject の中の Form XObject、模様、Type3 の字形) が深い・輪になっている | 深さの上限 (`pdfImageDepth`) を超えたら読めない画像。輪は、たどった印で止める (埋め込むときは pdf-lib の写し手が同じオブジェクトを 1 度だけ写す) | `image/pdf-invalid` (警告。理由に「入れ子が深すぎる」) |
| 上限 (4 節) を超えた: オブジェクトの数・ページの数・流れの大きさ | 読めない画像 | `image/pdf-limit` (警告。どの上限かを書く) |
| PDF の中に PDF が埋め込まれている (添付のファイル・ポートフォリオ) | 添付は持ち込まない (2.2 節)。ページの中身だけを貼る | なし |
| PDF の版が出力の版より新しい (2.0 の PDF を 1.7 の出力に貼る) | 貼る (版の違いで描けない機能は、まず無い)。PDF/X・PDF/A のときは 2.4 節の検査に任せる | なし |

- 読めない画像は、いまの読めない画像と同じく、**大きさが分かれば** その大きさの仮の枠で組む (ページの数・行の位置をずらさない)。
  大きさも分からないものは、いまの「中身を画像として読めない」(`image/not-found`) と同じ (既定の大きさの仮の枠)。
- 診断の名前は、いまの `image/*` の並びに足す (`src/diagnostics.ts` の表と、診断の説明書 (日英) の表)。
  足す名前: `image/pdf-invalid`・`image/pdf-encrypted`・`image/pdf-page`・`image/pdf-page-range`・`image/pdf-fragment`・`image/pdf-repaired`・`image/pdf-limit`・
  `image/pdf-placeholder` (3 節)・`image/pdf-dropped`・`image/pdf-font` (2.2 節)・`pdfx/embedded-pdf`・`pdfa/embedded-pdf` (2.4 節)。
  数を減らすなら、`image/pdf-encrypted`・`image/pdf-limit` を `image/pdf-invalid` の理由 (`detail`) にまとめてもよい (7 節の 8)。

### 1.5 画像の置き場 (AssetStore) に載せる形

- `ImageAsset` に `pdfSource?: { bytes: Uint8Array; page: number; box: PdfBox; rotate: 0 | 90 | 180 | 270; userUnit: number }` を足す
  (`page` は 0 から数えたページ、`box` は MediaBox に切り詰めた箱の 4 つの数 (pt))。`mime` は `application/pdf`、`bytes` は元の中身、`width`・`height` は 1.3 節の大きさ。
- `drawable: false` にする (画面・SVG・PNG は描けない。3 節)。`unsupported` は **付けない**。
  いまの `layoutEngine.ts` (`imageBox`) は、`unsupported` があると、出力によらずに組むときに `image/unsupported` を出すが、PDF の画像は PDF の出力では描けるので、
  警告は描けない出力の側で出す (3 節の `image/pdf-placeholder`)。
- `releaseImageBytes` (PDF だけを作るときに、埋め込んだ画像の中身を捨てる) は、ラスターの画像と同じに、埋め込んだ後に捨てる。
  同じバイト列から幾つものページを貼るときは、最後のページを埋め込むまで捨てない (いまの `pending` の数え方と同じ)。

---

## 2. PDF の出力

### 2.1 埋め込み方 (Form XObject)

- pdf-lib の `PDFDocument.load` で元の PDF を読み、**ページを Form XObject として埋め込む** (ISO 32000-1 §8.10。中身の流れと資源 (書体・画像・模様・色空間) がそのまま写り、ベクタのまま)。
  - pdf-lib の `embedPdf`・`embedPage`・`embedPages` は、**元の PDF にそのまま使わない** (8 節)。ページの辞書を丸ごと写すので、注釈が指す別のページから元の文書の全体が写りうるうえ、
    `getPages()` がページの木を再帰でたどり、輪を止めないため。
    代わりに、Kumiori がページを探し (8 節の 3)、写す前に、中身の流れ (Contents) と資源 (Resources) だけを持つ新しい辞書を作って、それを pdf-lib の写し手 (`PDFObjectCopier`) で写す。
    Form の流れは、`PDFPageEmbedder` と同じく、中身の流れを解いてつなぎ、`context.flateStream` で作る (Type・Subtype Form・BBox・Matrix・Resources に、下の Group を足す)。
  - 元の文書は、元のバイト列ごとに 1 度だけ読み、同じページは 1 つの XObject を使い回す (いまの `embeddedBytes` の考え方。弱い表で持つ)。
  - 読むときは、`pdfxVerify.ts` の `loadWithoutCopy` と同じ読み方 (メタデータを書き換えない) で読む。暗号化は 1.4 節で先に断る。
  - 箱で切り取る: 1.3 節の箱を Form の BBox にし、外は切り取られる (§8.10.1 Table 95)。Matrix は単位の行列のままにし、箱の左下を原点に寄せるのは描く行列で行う。
- 描くとき (`PdfPainter.drawImage`): いまのラスター画像と同じく、ページの資源の XObject の名前を画像ごとに 1 つにして (`imageName` と同じ)、
  `q <行列> cm /KmP0 Do Q` で置く。行列は、箱の左下を原点に寄せ、`/Rotate` の分を回し、図の大きさ (幅・高さの pt) に伸ばす。
  - pdf-lib の `PDFPageEmbedder` は `/Rotate` を見ない (8 節の 1)。回転は Kumiori が行列で掛ける (時計回り。§7.7.3.3 Table 30)。
  - UserUnit は、行列の倍率に含める。
- 透明のグループ: 元のページに `/Group` (ページのグループ。§11.6.6) があれば、Form XObject の `/Group` に写す
  (pdf-lib の `PDFPageEmbedder` は写さない (8 節の 1)。写さないと、元のページの中の描画モード (BM)・ソフトマスクの合わせ方が変わりうる)。
- 透明を平らにする出力 (PDF/X-1a・X-3。`std.transparency === 'flatten'`) では、元のページに透明があるかを 2.4 節の検査で見て、あれば平らにせずに仮の枠と `pdfx/embedded-pdf` にする
  (埋め込んだページを平らにする処理は、0.6.0 では作らない)。
- 背景の繰り返し (`drawImageTiled`) はベクタの画像を扱わない (false を返し、呼び手が 1 枚ずつ描く) ので、PDF の画像もそれに乗る (1 つの XObject を何度も Do する)。

### 2.2 持ち込むもの・持ち込まないもの

| もの | 扱い | 理由 |
| --- | --- | --- |
| 中身の流れ・資源 (書体・画像・模様・陰影・色空間・ExtGState・Form XObject) | 持ち込む (Form XObject の資源) | 図として見えるもの |
| 書体 | 持ち込む (元が埋め込んでいれば埋め込みのまま、埋め込んでいなければ埋め込まないまま)。埋め込んでいない書体があれば `image/pdf-font` (情報) を出す | ビューアが代わりの書体で描く。PDF/X・PDF/A では 2.4 節で断る |
| 注釈 (リンク・注記・フォームの欄・見え方) | **持ち込まない** | 図の中身でない。写すと、ページの外を指すリンク・動作・フォームの欄が、組んだ文書に紛れ込む。同じページを幾つも貼ると位置が重なる |
| 注釈の見え方のうち、印刷で見えるもの (Widget の値・スタンプ) | 持ち込まない (0.6.0)。中身に焼き込む (見え方の流れを Form に足す) のは今後 | 見た目が元の PDF と違うことがあるので、注釈のあるページなら `image/pdf-dropped` (情報。「注釈 n 個を持ち込みません」) を出す |
| しおり・名前の付いた行き先・ページラベル・文書の情報・XMP・出力意図・添付 | 持ち込まない | 文書の全体のもの。カタログを触らない (L7 とぶつからない) |
| 構造の木 (タグ)・印の付いた内容の MCID | 持ち込まない。タグ付き PDF のときは 2.3 節 | 元の構造の木を組んだ文書の木につなぐのは、0.6.0 の外 |
| 任意の内容 (Optional Content。§8.11) の BDC /OC | 中身の流れはそのまま (グループは持ち込まない)。カタログの OCProperties に無いグループを指す内容は、ビューアによっては常に見える。PDF/A では検査で断る (2.4 節。`pdfaVerify.ts` が、任意の内容があってカタログに OCProperties の無い PDF を合わないとする。ISO 32000-1 §8.11.4.1) | カタログを触らない |
| 元のページの `/Group` | 持ち込む (2.1 節) | 透明の合わせ方を変えない |
| 元のページの `/Thumb`・`/B` (記事)・`/Trans`・`/AA` | 持ち込まない | 図の中身でない |

### 2.3 タグ付き PDF のとき

- 図は **Figure** の構造の節にし、代わりの文 (Alt) を取る。いまの画像と同じ道 (`xslfoImport.ts` の `role = … 'Figure'`、HTML の `img` の `alt`、FO の `fox:alt-text`・`axf:alttext` など、いまの画像の代わりの文の取り方) をそのまま使う。
  代わりの文が無ければ、いまの画像と同じく PDF/UA の検査の数に入る (`pdfTags.ts` の、Alt の無い Figure の数え方)。
- 元のページの中身の流れにある、印の付いた内容 (`/P <</MCID 3>> BDC … EMC` など) は、組んだ文書の構造の木を指さない MCID になる
  (Form XObject の中の MCID は、Form の `StructParents` と親の木で構造の節に結び付けるもの。ISO 32000-1 §14.7.4.4)。
  そのまま写すと、行き先の無い MCID が残り、PDF/UA の検査 (veraPDF) に落ちうる。
  - 推奨: 写した Form の中身の流れを書き直し、**MCID を持つ BDC を、同じ札の BMC にする** (`/P <</MCID 3>> BDC` → `/P BMC`。EMC の釣り合いはそのまま)。
    作る段で、タグ付き PDF のときだけでなく、いつも外すことにした (中身の流れは埋め込むときにいつも解くので手間は変わらず、行き先の無い MCID はタグの無い PDF でも意味を持たないため。`src/pdfImageEmbed.ts` の `withoutMcids`)。
    資源の中の入れ子の内容の流れ (Form XObject・タイルの模様・Type3 の字形) の MCID も外し、XObject の `StructParents`・`StructParent` も消す (写し手は辞書ごと写すので、置き換えた流れを写させる。`copierWith`)。
    `/Artifact` の BDC は残す。Figure の中の内容なので、中の札は読む順・構造に入らない (§14.7: 印の付いた内容の札は、構造の木に結び付けなければ意味を持たない)。
  - 書き直すには、流れの圧縮を解いて (Flate など)、命令に分けて、詰め直す。圧縮を解く大きさは `pdfImageStreamBytes` で縛る (4 節)。
    命令に分ける道具は、`pdfxVerify.ts` の検査で使っているもの (`pdfContentStreams.ts` で集めた流れを読む所) を使い回す。
    元の流れが Flate 以外 (LZW・ASCII85 など) で解けないときは、書き直さずに仮の枠にし、`image/pdf-invalid` を出す (タグ付きのときだけ)。
  - 書き直した後に `node scripts/verapdf.mjs` (PDF/UA-1) にかけ、変える前と比べた結果をコミットの文に書く (CLAUDE.md の確かめ方)。
- 元の PDF の構造の木を持ち込んで、組んだ文書の木の Figure の子にする案 (アンテナハウスは設定でタグ付き PDF を取り込める) は、0.6.0 の外 (7 節の 5)。

### 2.4 PDF/X・PDF/A のとき

- いまは、書き出した PDF を最後に読み直して検査し (`verifyStandard`・`verifyStandardA`)、合わなければ文書の全体を誤り (`pdfx/not-conforming`・`pdfa/not-conforming`) にする。
  埋め込んだページが決まりに合わない (DeviceRGB を使う・書体を埋め込んでいない・透明がある) と、図 1 つのために文書の全体が出せなくなる。
- 推奨: **埋め込む前に、そのページだけを検査する**。合わなければ、そのページを埋め込まずに仮の枠で描き、`pdfx/embedded-pdf`・`pdfa/embedded-pdf` (警告) に、合わない理由 (検査の文) を書く。
  最後の検査は、いまのまま残す (取りこぼしは、いままでどおり文書の誤りになる)。
  - 検査は、`pdfxVerify.ts`・`pdfaVerify.ts` の、ページの中身と資源を調べる部分 (色空間・内容の流れの色の命令・透明・ExtGState の TR・HTP・網点・PostScript・圧縮の方式・書体の埋め込み・画像の Interpolate・Alternates・OPI・参照の XObject) を、
    ページ (または Form XObject) 1 つを受け取る関数に分けて、両方から使う。文書の全体の決まり (版の頭・Info・XMP・出力意図・trailer の ID・注釈) は、埋め込みには当てない
    (注釈は持ち込まない。出力意図・XMP は組んだ文書のもの)。
  - PDF/X で色を CMYK に直す (Kumiori の RGB の色・画像は CMYK に直している) ことを、埋め込んだページにはしない (中身の流れの色を書き直すことになり、ICC の扱いも変わる)。
    DeviceRGB を使うページは、PDF/X では仮の枠になる。利用者には、元の PDF を CMYK で書き出し直すよう警告で伝える。
  - 出力意図: 元の PDF の出力意図は無視する (アンテナハウスも無視する)。元が CMYK で、組んだ文書の出力意図と違う印刷条件でも、0.6.0 では見分けない (警告もしない)。
- PDF/X の版の頭 (X-1a:2001 は 1.3) より新しい機能 (透明・OpenType の書体の FontFile3 など) は、上の検査で拾う。
- 作る段で決めた形 (`src/pdfImageEmbed.ts` の `pdfPageProblems`): 検査の関数 (`pdfxVerify.ts`・`pdfaVerify.ts`) は、書き出した PDF の全体を読み直す作りなので、
  ページ 1 つの関数には分けなかった。そのページだけを描いた試しの PDF と、何も描かない土台の PDF を作り (出力意図は、組む PDF と同じ色空間の試しのもの)、
  同じ検査にかけて、土台に無い問題だけをそのページの問題とする (文書の全体の決まりの問題は、両方に同じに出るので打ち消し合う)。
  出力の PDF には、合うと分かったページだけを写す (断ったページの資源を、出力に残さない)。
- 透明を平らにする出力 (PDF/X-1a・X-3) では、PDF の画像を貼らない (`pdfx/embedded-pdf`。PDF/X-4 を勧める)。平らにする処理は、置いた物を重なりごとに画素にするが、
  PDF の画像を画素にする描き手が無い (3 節) ので、重なりに入れられないため。
- PDF/UA-1 (`--pdfua`) でも、埋め込んでいない書体のあるページは貼らない (`pdfua/embedded-pdf`。ISO 14289-1 §7.21.4.1。veraPDF の 7.21.4.1-1 に落ちる)。

### 2.5 そのほか

- 同じ入力から同じバイトの PDF (束 L7): 埋め込みは、元のバイト列とページだけで決まるようにする (Map の並び順・ページの番号順で写す。時刻を入れない)。
  pdf-lib の写し手 (`PDFObjectCopier`) が写す順は、元の中身で決まるので、同じ入力なら同じになる。作る段で、同じ文書を 2 度組んでバイトが同じかを試験にする。
- L7 とのぶつかり: この設計は、`pdfRenderer.ts` の画像を埋め込む所 (`embedAny`・`embedOnce` の並び。いまの 2600 行の辺り) と、描く所 (`drawImage`。1400 行の辺り) と、
  最後の検査の前 (埋め込みの前の検査は埋め込む所に置く) だけを変える。カタログと日付 (L7 が触る) は触らない。先に入った方に、後の方が載せ直す。

---

## 3. 画面 (Canvas)・SVG・PNG の書き出し

**推奨: 0.6.0 では、仮の枠と警告にする。PDF を描く仕組み (pdf.js など) は入れない。**

- 扱い: 画面 (`canvasRenderer.ts`)・SVG の書き出し (`svgRenderer.ts`)・PNG の書き出し (`pageRaster.ts`) は、`drawable: false` の画像として、いまの仮の枠を描く
  (大きさは 1.3 節で正しく組んであるので、ページの数・行の位置は PDF の出力と同じ)。
- 警告 `image/pdf-placeholder` (警告): 「PDF の画像 a.pdf#page=2 は、PDF の出力でだけ描けます。この出力 (画面・SVG・PNG) では仮の枠で描きます」。
  組むときでなく、描く出力の側で、文書あたり画像ごとに 1 度出す (PDF だけを作るときには出さない)。
- 画面 (デモの Web アプリ) からの PDF の書き出しは、pdf-lib が画面でも動くので、PDF の中では描ける (画面の表示だけが仮の枠)。
  仮の枠の中に「PDF p.2」のような短い札を描くかは、作る段で画面の見た目を見て決める (e2e の見本の画像が変わる)。

理由:

1. **Node で描けない**。pdf.js はページを Canvas 2D に描く仕組みで、Node では Canvas の実装 (node-canvas などのネイティブの依存) が要る。
   Kumiori の PNG の書き出しは、自前の画素の描き手 (`pageRaster.ts`) で、Canvas を使わない。pdf.js の描く命令を自前の描き手に受けるのは、
   pdf.js の内側の API (operator list) に頼ることになり、版が上がるたびに壊れうる。SVG の書き出しも、pdf.js の SVG の描き手は取り下げられたはず (pdf.js は入れないと決まったので、確かめていない)。
2. **配る大きさ**。pdf.js (pdfjs-dist) は、本体と worker で数 MB、日本語を描くには CMap と標準の書体のファイルも要る。Kumiori の配布物 (と画面) が大きく増える。
3. **ライセンス**は Apache-2.0 で入れられるが、`THIRD_PARTY_NOTICES.md` の節と、主な版の上げの追いかけが増える。
4. **安全**。PDF を描く仕組みは、書体・画像の復号・JavaScript (pdf.js は既定で動かさない) など、攻められる面が広い。0.6.0 では、PDF の中身を解くのは
   「ページを探し、箱を読み、資源を写す」までに留める (流れの中身を解くのは、タグ付きと PDF/X・PDF/A の検査のときだけ)。
5. 入稿の用途 (図・広告・別の道具で作ったページを PDF で渡す) は、出力が PDF なので、PDF の出力で描ければ足りる。

代わりの道 (今後):

- 利用者が描く仕組みを持ち込めるように、プラグインの受け口 (`imageFormats.ts`) の形式で PDF を SVG にするものを渡せば、画面・SVG・PNG ではそれで描く
  (7 節の 6 で、PDF の出力でもプラグインの SVG を使うか、本体の Form XObject を使うかを決める)。
- 自前で、PDF の中身の流れを SvgShape (Kumiori の図形の形) にする描き手を作る案もある (PostScript の描き手 `ps*.ts` と近い)。
  書体 (埋め込みの CFF・TrueType・Type1・Type3)・陰影・画像の復号 (JBIG2・JPX) まで要り、大きい。0.7.0 以降の候補として台帳に足す。

---

## 4. 安全と上限

### 4.1 守るもの

- **大きな PDF**: いまの `fileBytes` (渡したファイル 1 つ・取る画像 1 件。既定 256MB) がそのまま効く。pdf-lib は読み込むときに、全部のオブジェクトを読んで持つ
  (遅れて読まない) ので、小さなファイルでもオブジェクトの数が多いと、時間とメモリを使う。
- **多くのページ**: ページの木をたどる手間と、ページの数だけの表を作る手間。
- **深い入れ子**: ページの木の段 (Pages の中の Pages)、Form XObject・模様・Type3 の字形の入れ子、受け継ぐ属性を親へたどる段。
  pdf-lib のページの木のたどり方と写し手は再帰で、ページの木のたどり方は輪も止めない (8 節の 2・4)。Kumiori の側で、先に繰り返しでたどって、深さと輪を確かめる。
- **大きな流れ**: 圧縮を解く流れ (タグ付きのときの書き直し・PDF/X・PDF/A の検査)。展開の比 (小さな流れが巨大になる) も縛る。
- **時間**: pdf-lib の読み込みは、オブジェクトを 1 度に幾つかずつ読んで間を空ける (非同期) ので、時限と競わせられる。
  ただし、流れを解く間はイベントループが止まるので、時限の setTimeout は効かない。作る段で、読み手の中と、流れを解く間にも締め切りを見ることにした (8 節の 5)。

### 4.2 足す上限 (`src/limits.ts` の表に足し、`docs/library.md`・`docs/cli.md` の「入力の上限」の表 (日英) にも書く)

| 名前 | 既定 | 種類 | 守るもの |
| --- | --- | --- | --- |
| `pdfImageObjects` | 1,000,000 | 時間・大きさ (上げ下げ) | 1 つの PDF の画像の間接オブジェクトの数 (相互参照の表の項の数を、読む前に数える。超えたら読まない) |
| `pdfImagePages` | 100,000 | 時間・大きさ (上げ下げ) | 1 つの PDF の画像のページの数 (ページの木をたどる数) |
| `pdfImageDepth` | 64 | 落ちない (下げるだけ) | ページの木の段・受け継ぐ属性をたどる段・Form XObject などの資源の入れ子の深さ |
| `pdfImageStreamBytes` | 256MB | 時間・大きさ (上げ下げ) | 1 つのページで圧縮を解く流れの合計 (書き直し・検査のとき)。展開の比の縛りは `imageLimits.ts` の考え方に合わせる (ファイルの大きさによる縛りは変えない) |
| `pdfImageLoadMs` | 60,000 | 時間・大きさ (上げ下げ) | 1 つの PDF の画像を読み込む (pdf-lib の load と、ページを探す) 時限 (ミリ秒) |
| `pdfImageRangePages` | 64 | 時間・大きさ (上げ下げ) | 0.7.0 で足した。ページの範囲 (互換の指定) で並べるページの数。超えた分は貼らずに `image/pdf-page-range`。範囲のページの埋め込みでは、`pdfImageStreamBytes` と `pdfImageLoadMs` を範囲の全体で分け合い、中身の流れ・資源・透明のグループ・箱が同じページは 1 つの Form にする (`pdfImageEmbed.ts` の `pdfStreamBudget`・`formKey`) |

- 既定の値は、作る段で、手元の大きな PDF (数百ページの本・大きな地図) で時間とメモリを測って決め直す。上の値は、いまの `epubEntries`・`svgElements` などとの釣り合いで置いた仮の値。
- 1 つの文書の全体で PDF の画像に使う時間の合計 (`epsDocumentMs` に当たるもの) は、0.6.0 では足さない (pdf-lib の読み込みは EPS の実行より軽く、同じバイト列は 1 度しか読まない)。
  要ると分かったら、`pdfImageDocumentMs` として足す。
- fragment の違う参照の数は、いまの `formatFragments` を使う (1.2 節)。新しい上限を足さない。
- `design/limits.md` の棚卸しの表にも、足した上限を書き足す。

### 4.3 外の PDF を取るとき

- `http(s)` の PDF は、いまの画像と同じ決まりで取る: 文書の `files` → 利用者の関数 `resolveResource` → `fetchImages` が許せば取る。
  大きさの上限 (`fileBytes`)・時限 (`fetchTimeoutMs`・`imageFetchTotalMs`)・転送の扱い (https から http へは断る・`redirects`) も同じ。
- 取ったときの Content-Type が `application/pdf` でも、中身が `%PDF-` でなければ PDF として読まない (1.1 節)。
- **PDF の中から外を指すもの** (外のファイルを指す Form・参照の XObject (§8.10.4)・外の書体・リンクの動作・GoToR・URI・JavaScript・Launch) は、取らない・動かさない。
  参照の XObject (`/Ref`) は、写すときに外す (Form の中身の代わりの見え方があれば、それを使う。§8.10.4)。注釈と動作は 2.2 節で持ち込まない。

---

## 5. 試験の案

- **試験の PDF は試験の中で pdf-lib で作る** (他の人の著作物を入れない)。作る関数を `test/helpers/` に置く: ページの数・大きさ・MediaBox と CropBox・TrimBox・`/Rotate`・UserUnit・
  受け継ぐ箱 (Pages に置いた MediaBox)・注釈 (リンク)・しおり・構造の木と MCID・透明 (ca・ソフトマスク)・DeviceRGB の色・埋め込んでいない書体 (Helvetica の標準 14 書体)・
  暗号化 (Encrypt の辞書を手で足した、開けない PDF)・壊れた相互参照・頭の前のゴミ・深いページの木・深い Form の入れ子・多くのオブジェクト。
- 試験の分け方:
  - `test/pdfImage.test.ts`: 見分け方 (`isPdf`)、ページの選び方 (`page=N`・範囲・`bbox=`・RFC 8118 のほかの引数・互換の指定の有無)、大きさ (箱・回転・UserUnit・受け継ぎ)、
    壊れた・暗号化した・上限を超えた PDF の診断。
  - `test/pdfRenderer.*.test.ts` (いまの画像の試験の並び): 組んだ PDF を pdf-lib で読み直し、Form XObject (BBox・Matrix・Group・資源) と、描く行列 (回転を含む)・
    注釈・しおりを持ち込んでいないこと・同じページを 2 度貼ると XObject が 1 つ・2 度組んで同じバイト。
  - タグ付き: `--tagged` で組み、MCID の BDC が BMC になったこと・Figure と Alt。`node scripts/verapdf.mjs` (PDF/UA-1) にかけ、前と比べる。`pdfinfo -struct-text` で読む順も見る。
  - PDF/X・PDF/A: 合うページは埋め込まれ、最後の検査を通る。合わないページ (DeviceRGB・透明・埋め込んでいない書体) は仮の枠と `pdfx/embedded-pdf`・`pdfa/embedded-pdf`。
  - 画面・SVG・PNG: 仮の枠と `image/pdf-placeholder`。画面の動きを変えるので `npm run e2e` も通す。
  - 上限: `test/limits.test.ts` の、表と元の定数が食い違わないことの確かめに、足した上限が入る。
- **見本との組み比べ**: アンテナハウスのサンプル FO 集には、PDF を画像にする見本 (`graphics-pdf-1`・PDF の埋め込みのページを選ぶ見本 (`pdf-embedding-2`) など) が公開されている。
  手元の見本 (`.cache/samples`) にあれば、作る段で `npm run compare:base -- --base <作る前のコミット> --head .` と `scripts/compare-pdf.mjs` で、見本の PDF と組み比べる
  (互換の指定 `--compat antenna` で組む。範囲を指した見本は、最初のページだけが合うはず)。変わった文書とページが PDF の画像の所だけかを確かめ、コミットの文と台帳の覚え書きに書く。
  見本の中の PDF (見本が貼る PDF のファイル) も他の人の著作物なので、リポジトリに入れない。
- 領域の木の指紋 (`test/fingerprints/`): PDF を貼る文書はリポジトリの見本に無いはずなので、変わらないはず。変わったら確かめる。

---

## 6. 大きさの見積もりと、作る段のコミットの分け方

大きさ: **中〜大** (src で 1,200〜1,800 行、試験で 800〜1,200 行、説明書 (日英) で 200 行ほど)。いちばん重いのは、PDF/X・PDF/A の検査をページ 1 つに分ける所と、タグ付きのときの流れの書き直し。

作る段は **4 回のコミット** に分ける (どれも `npm run typecheck`・`npm test` を通す。4 は `npm run e2e` も)。

1. **読む**: `isPdf`・`src/pdfImage.ts` (読み込み・ページの選び方・箱・回転・UserUnit・壊れた・暗号化・上限)・`AssetStore` の登録 (`pdfSource`・fragment の読み直し)・
   上限の表 (`limits.ts`)・診断の名前。この時点では、どの出力でも仮の枠 (正しい大きさ)。試験は `test/pdfImage.test.ts`。
2. **PDF に埋め込む**: Form XObject の埋め込みと使い回し・描く行列 (回転)・`/Group`・持ち込まないもの・`releaseImageBytes`・同じバイトの試験。
   タグ付きのときの MCID の書き直しと、veraPDF の前後の比べ (コミットの文に書く)。
3. **PDF/X・PDF/A**: `pdfxVerify.ts`・`pdfaVerify.ts` の、ページの中身と資源の検査を、ページ 1 つの関数に分け、埋め込む前に使う。合わなければ仮の枠と警告。
   この分け直しで、いまの最後の検査の結果が変わらないことを、いまの試験で確かめる。
4. **画面・SVG・PNG と説明書**: `image/pdf-placeholder`・(仮の枠の札)・`docs/library.md`・`docs/cli.md`・診断の説明書・`CHANGELOG` (日英)・
   アンテナハウスの見本との組み比べの結果。

2 と 3 は、どちらを先にしてもよい。L7 が先に `pdfRenderer.ts` に入ったら、2 の前に載せ直す。

---

## 7. 決め (2026-11-22 に、どれも推奨の案に決まった)

決まった案は、各項目の初めの (推奨) のもの。ほかの案は、決めたときの候補として残す。

1. **ページの範囲 (`page=2-3`・`page=all`) の扱い** (互換の指定のとき)
   - (推奨) 範囲の最初のページだけを貼り、`image/pdf-page-range` を出す。流すのは 0.7.0 の流し書きと一緒に。
   - 範囲を断り (読めない画像)、仮の枠にする。
   - 範囲のページを、横に並べた 1 つの図にする (アンテナハウスの動きとも違うので、しない方がよい)。
   - 0.7.0 で改めた: アンテナハウスの見本 (サンプル FO 集の pdf-embedding-2・graphics-pdf-1) を確かめると、範囲のページを間を空けずに 1 行に横に並べ、
     下端をそろえた 1 つの図にしていたので、互換の指定のときはそれに合わせた (1.2 節)。並べるページの数は上限 `pdfImageRangePages` (既定 64) まで (4.2 節)。
     背景の画像 (`background-image`) に範囲を指したときは、見本と同じく範囲の最初のページだけを敷く (名前はクエリを除いた道の最後の部分で見る。
     拡張子の無い URL も同じ)。流し書き (0.7.0) とは繋げていない。
2. **箱の選び方 `bbox=` を読むモード**
   - (推奨) 互換の指定 (`--compat antenna`・`--style ah`) のときだけ読む。RFC 8118 に無い引数で、接頭辞が無いので、CLAUDE.md の決まりどおり。
   - どのモードでも読む (fragment は形式ごとの決まりで、`bbox` は標準の引数を上書きしないので、害は無い、と見る)。
   - 箱を選ぶ独自の選択肢 (`TypesetOptions.pdfImageBox` と `--pdf-image-box`) を足す (文書でなく組む人が決める。互換の指定によらない)。推奨の案と一緒に足してもよい。
3. **PDF/X・PDF/A に合わない埋め込みのページ**
   - (推奨) 埋め込む前にページ 1 つを検査し、合わなければ仮の枠と警告 (`pdfx/embedded-pdf`・`pdfa/embedded-pdf`)。文書は出せる。
   - 合わなければ誤りにして、文書を出さない (入稿の事故を確実に止める。いまの最後の検査と同じ厳しさ)。
   - 検査をせずに、最後の検査に任せる (作るのは軽いが、文書の全体が誤りになり、どの図のせいかが分かりにくい)。
4. **画面・SVG・PNG**
   - (推奨) 仮の枠と `image/pdf-placeholder`。pdf.js は入れない (3 節の理由)。
   - pdf.js を画面 (ブラウザ) だけに入れる (画面は描けるが、配る大きさが数 MB 増え、Node の SVG・PNG は仮の枠のまま)。
5. **タグ付き PDF のときの、元の構造の木**
   - (推奨) 持ち込まない。中の MCID を外し、図 1 つの Figure にする。
   - 元の構造の木を、組んだ文書の Figure の子として写す (読む順・代わりの文が元のまま残るが、Form の StructParents と親の木を作り直す大きな仕事。0.7.0 以降)。
6. **PDF を見分けるプラグインを利用者が渡したとき**
   - (推奨) いまの決まり (プラグインが先) のまま、どの出力でもプラグインの SVG を使う。本体の PDF の読み方は使わない。
   - PDF の出力だけは本体の Form XObject を使い、画面・SVG・PNG ではプラグインの SVG を使う (出力ごとに中身が変わりうるので、決まりが分かりにくい)。
7. **RFC 8118 の `nameddest=` (名前の付いた行き先のページ)**
   - (推奨) 0.6.0 では読まない (無視して、警告も出さない)。
   - 行き先の名前から、そのページを選ぶ (名前の木・Dests の辞書を引く。小さな仕事)。
8. **診断の名前の数**
   - (推奨) 1.4 節の名前をそのまま足す (`image/pdf-invalid`・`-encrypted`・`-page`・`-page-range`・`-fragment`・`-repaired`・`-limit`・`-placeholder`・`-dropped`・`-font` と `pdfx/embedded-pdf`・`pdfa/embedded-pdf`)。
     利用者が名前で絞れる (`--quiet` などで、暗号化だけを誤りにする、など)。
   - 読めないもの (`-invalid`・`-encrypted`・`-limit`) を `image/pdf-invalid` 1 つにまとめ、理由を `detail` に書く。書体の埋め込みの情報は出さない。
9. **上限の既定の値** (4.2 節): 仮の値のまま作り、作る段で測って決め直す (推奨)。決め直した値は、作る段の報告で取りまとめ役に見せる。

---

## 8. pdf-lib (1.17.1) の中で確かめたこと

`npm ci` で入れた `node_modules/pdf-lib/cjs` を読んだ (2026-11-22)。版を上げたら確かめ直す。

1. **`PDFPageEmbedder` (`core/embedders/PDFPageEmbedder.js`)**
   - Form の辞書に書くのは Type・Subtype (Form)・FormType・BBox・Matrix・Resources だけ。**`/Rotate` も `/Group` も見ない**。
   - 箱を渡さないときの既定の箱は MediaBox の幅と高さで、**左下を (0, 0) にする** (MediaBox の左下が原点でないページでは、ずれて切り取られる)。
   - 中身の流れは、全部を解いてつなぎ、Flate で詰め直す (`decodePDFRawStream`)。解ける圧縮は FlateDecode・LZWDecode・ASCII85Decode・ASCIIHexDecode・RunLengthDecode だけで、
     ほかの方式 (Crypt など) は誤りを投げる。中身の流れが無いページは `MissingPageContentsEmbeddingError` を投げる (空のページは、Kumiori が空の Form にする)。
     解いた大きさの縛りは無いので、Kumiori が `pdfImageStreamBytes` で確かめながら解く (いまの展開の大きさの縛りと同じ考え方)。
   - 中身の流れは埋め込むときにいつも解くので、2.3 節のタグ付きのときの書き直しも、そのときにまとめて行う (流れを 2 度解かない)。
2. **`PDFPageLeaf` の受け継ぎ (`core/structures/PDFPageLeaf.js`・`PDFPageTree.js`)**
   - `InheritableEntries` は Resources・MediaBox・CropBox・Rotate で、`getInheritableAttribute` が親をたどって解く。
   - 親へのたどり方 (`ascend`) は**再帰で、輪を止めない** (Parent が輪になった PDF では、スタックを使い切るまで回る)。
   - `normalize()` は、ページの辞書に Resources・Font・XObject・ExtGState・Annots の空の辞書を書き足し、中身の流れを q と Q の流れで包む (元の文書のオブジェクトを書き換える)。
     元の文書は読むだけにし、`normalizedEntries()` を呼ばない。
3. **ページの木のたどり方 (`PDFDocument.getPages`・`PDFPageTree.traverse`)**
   - 子 (Kids) を**再帰でたどり、輪を止めない**。ページの数だけ `PDFPage` を作る (ページの数の縛りも無い)。
   - そのため、Kumiori は `getPages()` を呼ばずに、カタログの Pages から、繰り返し (明示のスタック) で、たどった印と深さ (`pdfImageDepth`)・数 (`pdfImagePages`) を見ながら、
     N 番目のページの辞書と、受け継ぐ属性を探す。Count の値は信じず、数えた数で決める。
4. **写し手 (`core/PDFObjectCopier.js`)**
   - たどった印 (`traversedObjects`) があるので、**輪は止まる**。ただし辞書・配列・参照を**再帰で写す**ので、深い入れ子 (配列の中の配列…) ではスタックを使い切る。
     写す前に、写すもの (資源の辞書から届くもの) を Kumiori が繰り返しでたどって、深さと数を確かめる (深さは `pdfImageDepth`、数は `pdfImageObjects`)。
   - ページを写すとき (`copyPDFPage`) は、受け継ぐ属性をページに移し、Parent だけを消して、**ほかの項目 (Annots・StructParents・B・Thumb・AA など) を全部写す**。
     注釈の行き先 (Dest) が別のページを指していれば、そのページと、その Parent から元の文書のページの木の全部が写る。
     `embedPdf`・`embedPages` は、この写し方でページを写してから埋め込むので、使わない (2.1 節)。持ち込まないもの (2.2 節) は、写す前の辞書に入れないことで落とす。
5. **読み込み (`PDFDocument.load`・`core/parser/PDFParser.js`)**
   - 暗号化した PDF は、`ignoreEncryption` を付けなければ `EncryptedPDFError` を投げる (trailer の Encrypt を見る)。これで暗号化を見分ける (1.4 節)。
   - 読み手は、ファイルの頭から、間接オブジェクトを順に読む (相互参照の表に頼らない。同じ番号のオブジェクトは後のものが勝つ)。相互参照の表が壊れていても読める。
     読めないオブジェクトは、`throwOnInvalidObject` が false (既定) なら飛ばす。Root が無ければ、カタログらしいオブジェクトを探して直す (`maybeRecoverRoot`)。
     直したかどうかは外から分からないので、`image/pdf-repaired` は、頭が先頭に無いときと、Kumiori が見つけた食い違い (Count と数えた数の違いなど) のときに出す。
   - 全部のオブジェクトを、読み込みの時に読んで持つ (遅れて読まない)。オブジェクトの数は読み終えるまで分からないので、`pdfImageObjects` は、読む前にバイト列の中の `obj` の語の数で見積もって断り、
     読んだ後に数えた数でも確かめる。読む時間は、`objectsPerTick` (既定で 1 度に 100 個ずつ、間を空ける) があるので、`pdfImageLoadMs` の時限と競わせられる。
   - 読み手は、オブジェクトの流れ (`/Type /ObjStm`。§7.5.7) と相互参照の流れ (`/Type /XRef`。§7.5.8) を、読んだときに**縛り無しに全部解く** (`parseIndirectObject`)。
     解く間はイベントループが止まるので、時限も効かず、時限が切れた後も読み手は裏で読み続ける。obj の語の数の見積もりには、ObjStm の中のオブジェクトが入らない
     (0.6.0 の読み直しで、1MB の PDF が解いて 1GB になり、2.2GB を使った)。
     そのため、Kumiori は読み手の `parseObject` を包み (`src/pdfStreamGuard.ts` の `loadPdfGuarded`)、読んだ ObjStm・XRef の流れを、解く前に、縛りの中で解いた流れ (Filter の無いもの) に替える。
     縛りは、ObjStm の N を `pdfImageObjects` に足すことと、解いた大きさの合計を `pdfImageStreamBytes` と、ファイルの大きさの 100 倍 + 1MB の小さい方にすること (`imageLimits.ts` の `PDF_OBJSTM_MAX_RATIO`)。
     読み手の中で締め切り (`pdfImageLoadMs`) も見て、時限が切れたら読み手も止める。読み手はオブジェクトを読むときの誤りを握りつぶすので、当たった後は残りを読まずに飛ばさせ、読み終えてから誤りにする。
   - 流れの圧縮を解くのは、どこでも `decodeGuarded` (1 段ずつ解き、どの段の出力も残りの大きさを超えたら止める。Flate は長さを先に数える。ほかの方式は少しずつ取る)。
     二重の Flate・DecodeParms 付き・LZW も、解く前・解く間に縛る。
   - PDF/X・PDF/A の、埋め込む前の検査 (2.4 節) は、写した資源の中の内容の流れ (入れ子の Form XObject・タイルの模様・Type3 の字形) と ICCBased の色空間の流れを解く。
     検査の前に、`preparePdfPage` がそれらを縛りの中で解き (ページの中身の流れと合わせて `pdfImageStreamBytes`)、内容の流れの MCID も外す (2.3 節) ので、検査には縛りの中で解けると確かめた流れだけが届く。
   - `updateMetadata` は false にして読む (元の文書の Info を書き換えない。`loadWithoutCopy` と同じ)。

