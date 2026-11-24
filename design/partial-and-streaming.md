# 先頭から N ページで止める・PDF をページごとに流して書き出す、の設計の覚え書き

長い文書の最初の数ページだけを組む選択肢 (`maxPages`) と、PDF をページごとに書き出し先へ流して、PDF の側のメモリの山を下げる口を足す設計です。
作る前に、取りまとめ役が見る。この覚え書きは、リリースする文書 (`docs/` など) ではありません。

前提にしたもの:

- 利用者の決め: `maxPages` を入れる (長い文書のプレビュー。決まらない相互参照は警告。`TypesetOptions` に置き、`limits` には入れない。
  指定しないときは上限なし)。PDF をページごとに流して書き出す口を作る (pdf-lib の作りでできない所は、代わりの作りを決める)。
  選択肢は足すだけで、渡さなければ前と同じに動き、組版の結果も PDF も同じ。
- main にある、止める合図・進み具合の作り (`design/call-control.md`): `LayoutControl` (`page`・`boundary`)、`notePage` (置くページを作った所だけで呼ぶ)、
  `passSteps`・`onceSteps` (回・page-sequence の境目で yield するジェネレーター)、`CallContext` (`lang`・`signal`・`onProgress`・`limits`)。
- 上限の設計 (`design/limits.md` の 8 の決め 7): `maxPages` は `limits` に入れない。

## 0. 先に分かったこと (設計の形を決めるもの)

- **ページ N は、ページ N+1 を作った時に決まっている。** 1 段の流れ (`Flow`) は、改ページの前に、いまのページを閉じる
  (開いた箱の断片を閉じ、後ろに置く float・脚注を出し (`emitAfterFloats`・`emitFootnotes`)、widows・orphans で送る行も、送ってから次のページを頼む)。
  次のページを作った後に、前のページへ中身を戻すことは無い。したがって、ページ N+1 を作る所 (`notePage`) で止めれば、ページ 1〜N は全体を組んだときと同じになる
  (段組の並び (`layoutColumnSequence`) は、脚注・前方 float の予約のために、page-sequence を何回も組み直すが、どの回も同じ所で止めるので、試験で同じことを確かめる。5 の 1)。
- **ただし、ページ N の後ろへ続く要素は、N+1 を組まないと分からない。** `page-number-citation-last` (XSL 1.1 §6.6.12) の「最後のページ」は、
  要素がページ N で終わるのか、N+1 へ続くのかで変わる。そこで、**N+1 ページ目まで組み (見張りのページ)、N+2 ページ目を作る所で止め、N+1 ページ目は捨てる**。
  見張りのページで、id の置かれた最初・最後のページが N より後ろかを見分ける (2.4)。手間は 1 ページ分だけ増える。
- **止めても、文書の読み込みとカスケードは全体で行う。** 組版の手前 (HTML・XSL-FO の読み込み、CSS のカスケード) は、文書の全体を組版の木にする。
  `maxPages` で減るのは組版 (ページ分け・行分け・柱など) と PDF の書き出し。対応仕様説明書 (HTML。147 ページ) の typeset 15 秒のうち、読み込み・カスケードの 4〜5 秒は残る
  (`design/relayout.md` の 2.2)。読み込みを途中で止める作りは、0.6.0 では作らない (7 の決めに入れない。後の課題)。
- **PDF の側のメモリは、文の多い文書では小さい。** 測った値 (3.4): 1,600 ページの文の文書で、JS のヒープの山は 1.5GB、PDF は 4MB。
  山は組版の途中の木 (ページの論理の木 `PageBuild`) で、PDF の書き出しのときには、もう山を越えている。流し書きで下がるのは、PDF の大きさの 2 倍ほど
  (保存のときに持つ流れの全部と、書き出したバイト列の 1 つの配列) で、画像の多い文書 (PDF が数百 MB) で効く。文の多い文書のメモリを下げるのは、
  流し書きではなく、メモリ節約 (`lowMemory`) と `maxPages` の側。この見通しを、文書 (`docs/library.md`) にも書く。
- **pdf-lib の保存 (`PDFDocument.save`) は、文書の全体を 1 つの配列に書く。** 間をあけて書く口・書いたオブジェクトを捨てる口は無い (3.1)。
  ただし、書き方は単純 (オブジェクトを番号の順に並べ、最後に相互参照の流れを書く) で、使う部品 (`PDFCrossRefStream`・`PDFObjectStream`・`PDFHeader`・`PDFTrailer`) は
  公開されている。そこで、**保存と同じ書き方を、先に書けるオブジェクトを先に書く形で自前で書く** (3.2)。

## 1. 公開する API の形

### 1.1 先頭から N ページで止める (`maxPages`)

```ts
export interface TypesetOptions {
  // … いまの選択肢 …
  /**
   * 先頭から maxPages ページまで組んだら、組むのをやめる (長い文書のプレビュー)。1 以上の整数。既定は指定なし (全体を組む)。
   * 止めたときは、結果の truncated が true になり、info の診断 layout/max-pages-reached を 1 件出す。
   * そのページより後ろにある所を指すページ番号の参照 (page-number-citation・target-counter など)・総ページ数 (counter(pages) など)・
   * 索引のページ番号・しおりの飛び先は決まらないので、"?" で組み (しおりは飛び先の無いしおりにする)、警告 layout/beyond-max-pages を出す。
   * 文書の読み込みとカスケードは、文書の全体で行う (減るのは、組版と PDF の書き出しの手間)
   */
  maxPages?: number;
}

export interface TypesetResult  { /* … */ /** maxPages で途中で止めたか */ readonly truncated: boolean }
export interface TypesetPdfResult { /* … */ truncated: boolean }
export interface AreaTree { /* … */ /** maxPages で途中で止めた木だけに付く */ truncated?: { maxPages: number } }
```

- 置き場所: `TypesetOptions` (利用者の決め)。`TypesetterOptions` の `Pick` には入れないので、`DocumentOptions` (器の文書ごとの設定) にも入る。
  `SETUP_ONLY_OPTIONS` には入れない。
- 検査: `checkOptions` に足す。1 以上の安全な整数でなければ `KumioriOptionError` (`api/invalid-option`。いまの選択肢の検査と同じ)。
  `Infinity` も誤り (「指定しない」は省く)。
- 領域の木の `truncated` は、止めた木だけに付く無くてもよい欄なので、`schemaVersion` は上げない (`diagnostics` を足したときと同じ。`docs/area-tree.md` の「版」)。
  止めない木の形は前と同じ (領域の木の指紋が変わらない)。
- `CallContext` には載せない (L1 の覚え書きの 8.2 では載せる見込みだった)。読むのは `LayoutEngine.notePage` の 1 か所で、
  `LayoutEngine` は呼び出しごとに `api.ts` が作るので、`LayoutOptions.maxPages` で渡せば足りる。深い所 (画像の読み・字の測りなど) で読むものではなく、
  結果の `toPdf` などにも引き継がない (組んだ木が、もう止めた木になっている)。7 の 6 で確かめる。

### 1.2 PDF を流して書き出す

```ts
/**
 * PDF の書き出し先。WritableStream (WHATWG Streams §5) か、バイト列の塊を受ける関数。
 * 関数が Promise を返したら、次の塊を渡す前に待つ (書き出し先が遅いときに、塊をためすぎない)。
 * 関数が値を返さなければ、待たずに次を渡す (Node の fs.writeSync など。メモリ節約の組版でも、ページごとに書ける)
 */
export type PdfOutput = WritableStream<Uint8Array> | ((chunk: Uint8Array) => void | Promise<void>);

/** 流して書いた PDF の結果 (TypesetPdfResult から pdf を除き、書いたバイト数を足したもの) */
export interface TypesetPdfStreamResult extends Omit<TypesetPdfResult, 'pdf'> {
  /** 書き出し先に書いたバイト数 */
  bytes: number;
}

/** 文書を組み、PDF をページごとに output へ流して書く (typesetToPdf と同じ PDF の中身。PDF の全体を 1 つの配列に持たない) */
export function typesetToPdfStream(text: string, options: TypesetOptions, output: PdfOutput, pdf?: TypesetPdfOptions): Promise<TypesetPdfStreamResult>;

export interface Typesetter {
  // … いまの typeset・typesetToPdf …
  typesetToPdfStream(text: string, options: DocumentOptions | undefined, output: PdfOutput, pdf?: TypesetPdfOptions): Promise<TypesetPdfStreamResult>;
}

export interface TypesetResult {
  // … いまの toPdf …
  /** toPdf と同じ PDF を、output へ流して書く。返すのは書いたバイト数 */
  toPdfStream(output: PdfOutput, options?: PdfOptions): Promise<{ bytes: number }>;
}
```

- 形の選び方: `TypesetPdfOptions` に `output` を足して `typesetToPdf` が流す形は、結果の `pdf: Uint8Array` が空になり、型で分けられないので採らない。
  関数を分ける (`…Stream`)。`ReadableStream` を返す形 (引く側が進める) は、組版が押す側 (ページを作るたびに書く) なので、内に溜めの並びが要り、
  採らない。`ReadableStream` が欲しいときは `TransformStream` を挟む (`const { readable, writable } = new TransformStream(); typesetToPdfStream(text, o, writable); return new Response(readable)`)。
  この使い方を `docs/library.md` に書く。
- `WritableStream` の扱いは、`ReadableStream.prototype.pipeTo` の既定 (WHATWG Streams §4.2.5。`preventClose`・`preventAbort` が false) に合わせる:
  書き終えたら `close()`、誤り・止める合図で終えたら `abort(理由)`。書き手 (`getWriter()`) のロックは、終えたら放す。
  書くたびに `writer.ready` を待つ (書き出し先の背圧に従う)。
- 塊の大きさ: 64KB までためてから書く (小さなオブジェクトごとに書き出し先を呼ばない)。ページの終わりと、最後には、たまった分を書く。
- 入口ごと:

  | 入口 | 形 | 備考 |
  |---|---|---|
  | `typesetToPdfStream` | `(text, options, output, pdf?)` | `typesetToPdf` と同じ組み方 (`lowMemory` も)。`options.signal` が書き出しの終わりまで効く |
  | `Typesetter.typesetToPdfStream` | `(text, options, output, pdf?)` | 器の版 |
  | `TypesetResult.toPdfStream` | `(output, options?)` | 組んだ木から書く。領域の木は持ったままなので、下がるのは PDF の側の分だけ |
  | `kumiori/browser`・Web Worker | 同じ (`api.ts` が同じ) | 保存の窓 (`showSaveFilePicker().createWritable()`) は `WritableStream` なので、そのまま渡せる。Worker の中では OPFS の同期の書き手 (`createSyncAccessHandle`) を関数で渡せる |
  | Node | 同じ | `Writable.toWeb(fs.createWriteStream(p))`、または `(c) => fs.writeSync(fd, c)` |

- `maxPages` と流し書きは、別々に使える (合わせて使ってもよい)。

### 1.3 コマンド

- `--max-pages <N>` を足す (PDF・SVG・PNG のどれにも効く。プレビューの確かめに使う)。`--pages <範囲>` (SVG・PNG に書くページを選ぶもの) は、そのまま。
  `--pages` が N より後ろのページを指したら、いまの「範囲の外のページ」と同じ扱い。
- PDF の書き出しは、選択肢を足さずに、いつも流して書く (推奨。7 の 5)。書き出し先は、出力のファイルと同じディレクトリの一時のファイル
  (`<出力>.part-<乱数>`) で、書き終えたら名前を替える (途中で失敗・中断したときに、壊れた PDF を残さない。`--watch` で、書きかけを開かせない)。
  `--pdfx`・`--pdfa` のときは、いまのとおり全体を作ってから書く (4 の 3)。

## 2. maxPages の作り

### 2.1 数える所・止める所

- 数える所は、L1 で決めた `notePage(local)` (置くページを作った所: `layoutSequence` の `mkPage`・`layoutColumnSequence` の `ensurePage`・`forcePageCount` の白ページ)。
  いまの組版の回で作ったページの数 `this.pagesBuilt.length + local` が `maxPages + 2` になったら (見張りの N+1 ページを組み終え、N+2 ページ目を作った所)、
  内向きの印 `PAGE_LIMIT` (`LayoutEngine` の中だけの、誤りでない印の値) を投げる。
  - 組んでみるだけの組版 (段組の釣り合わせ・`o.trial`・`typesetForeign`) は `notePage` を呼ばないので、止まらない (L1 が試験で守っている)。
  - メモリ節約の、決まった回を描くための組み直し (`replaySink`) でも数えて止める (同じ所で止めないと、描くページが変わる)。
    `control.page` (進み具合) は、いまのとおり組み直しでは呼ばず、N より後ろのページ (見張りのページ) でも呼ばない (進み具合の pages は N を超えない)。
- 受ける所は、`onceSteps` の page-sequence の繰り返しの中 (1 つの page-sequence を組む所を `try` で包む)。受けたら、
  - 組んでいた page-sequence のページを取り出す。`layoutSequence`・`layoutColumnSequence` は、作ったページの並びを返す前に投げられるので、
    並びを作ったときに `this.seqBuilding` に置いておく (投げた後も、そこから取れる)。
  - そのうち、文書の初めから N ページ目までを残し、見張りのページ (N+1) は捨てる (`releasePage`)。見張りのページに置いた id は、2.4 で使ってから消す。
  - この page-sequence の覚え (`seqMemo`) は作らない (止めた並びは、次の回で使い回さない)。後ろの page-sequence は組まない (繰り返しを抜ける)。
  - 条件付きのマスター (`last`・`only`・`rest`。XSL 1.1 §7.27.14) の組み直しの繰り返し (`needsLast`) の途中で受けたときも同じ。最後のページは分からないままなので、
    止めたページは、最後のページでないページとして組まれている (全体を組んだときも、最後のページより前のページは同じマスター)。
  - `force-page-count` (§7.27.6) の白ページを足す所で受けたときも同じ。
- 止めた後の回の終わり (柱など `sheetStatics`・メモリ節約の柱と渡し) は、残した N ページについて、いまのとおり行う。
  柱の中の総ページ数・`retrieve-marker` は、残したページで決まる (総ページ数は 2.4 のとおり "?")。

### 2.2 組み直しの回との合わせ方

- **どの回も、同じ N で止める** (推奨。7 の 1)。ページ番号の参照・ページごとの脚注番号・索引を決める組み直しの回 (`passSteps` の 4 回まで) は、
  どれも `onceSteps` を通るので、どの回でも 2.1 の所で止まる。収束の判定 (参照の値・脚注の並び・索引の並びが前の回と同じか) は、いまのまま
  (止めたことと、N より後ろの id の集まりも、判定に入れる: 回によって止まったり止まらなかったりしたら、同じでないとみる)。
- 最後の回だけ N で止める形は採らない (どの回が最後かは、組んでみるまで分からず、前の回を全体で組むと、止める意味が無い)。
  「1 回目だけ全体を組んで参照の値を決め、2 回目から N で止める」形は、参照は正しくなるが、全体を 1 度組むので、プレビューの速さにならない (7 の 1 の候補)。
- 止めたときの結果の正しさ: ページ 1〜N の組版は、N ページより後ろを指す参照の字 ("?") のほかは、全体を組んだときの 1〜N ページと同じ
  (参照の字の幅が変われば、その行から後ろの組みが変わることはある。全体を組んだときも、参照の値で組みが変わるのと同じ)。5 の 1 で確かめる。

### 2.3 組版の量の見積もり

- 組版の手間は、ページ 1〜N+1 の分 × 組み直しの回の数 (+ 条件付きのマスター・段組の組み直し)。読み込み・カスケードは全体 (0)。
- 柱など (`sheetStatics`)・領域の木 (`finishTree`)・PDF は N ページ分。
- 例: 対応仕様説明書 (HTML。147 ページ。typeset 15 秒・toPdf 2.3 秒) を `maxPages: 3` で組むと、読み込み・カスケードの 4〜5 秒と、4 ページ × 回の数の組版になる見込み。
  作る段 (6 のコミット 2) で測って、この覚え書きに書く。

### 2.4 決まらない相互参照

止めたときに決まらないものと、その扱い:

| もの | 根拠 | 見分け方 | 組む字・扱い | 診断の kind |
|---|---|---|---|---|
| ページ番号の参照 (XSL `page-number-citation`・CSS `target-counter()`) | XSL 1.1 §6.6.11 | 参照先の id が文書にあり、最初に置かれたページが N より後ろ (見張りのページ) か、どこにも置かれていない | "?" (WeasyPrint の組み方では空。`unresolvedCitationEmpty`。見つからない id と同じ) | `page-number-citation` |
| 最後のページの番号 (XSL `page-number-citation-last`) | XSL 1.1 §6.6.12 | 参照先の id の最後の断片が、見張りのページにあるか、どこにも置かれていない | "?" | `page-number-citation-last` |
| 総ページ数 (CSS `counter(pages)`。中では `TOTAL_PAGES_ID` の参照) | CSS Paged Media 3 のページのカウンター | 止めたら、いつも | "?" (N を出すと、違う数を見せる) | `total-pages` |
| 索引のページ番号 | XSL 1.1 §6.10 | 止めた回で、索引の並びを 1〜N ページに組んだ | 1〜N ページの分だけを並べる (後ろのページの所は抜ける) | `index` |
| しおりの飛び先 | XSL 1.1 §6.11.1 | 飛び先の id が、N より後ろ | 飛び先の無いしおり (`sheet: -1`。いまの「見つからない飛び先」と同じ形。題は残す) | `bookmark` |
| 文書の中のリンク | — | 飛び先の id が、N より後ろ | いまの見つからない飛び先と同じ (リンクの注釈を書かない) | 出さない (いまも見つからない飛び先を警告していない。止めたことは `layout/max-pages-reached` で分かる) |

- 見分けの元: 止めた回で、見張りのページ (N+1) に置いた id (`idPageBuild`・`idPageBuildLast` が見張りのページを指すもの) と、
  文書の中の id の集まり (入力の節の番号付け `indexDocument` のついでに作る) から、「N より後ろにある id」(最初が後ろ) と
  「N より後ろへ続く id」(最後が後ろ) の 2 つの集まりを作る。見張りのページは捨てるので、その id は `idPages` などから消す。
- 文書に無い id は、いまのとおり `layout/missing-id`。文書にあって N より後ろの id だけを、新しい診断にする (見つからない、と言わない)。
- 1 回目の組版 (前の回の参照の値が無い回) の仮の値は、いまのまま (後ろへの参照は、いまのページ番号)。2 回目から 2.4 の扱いになる。
- 診断 (`src/diagnostics.ts` の表と `docs/diagnostics.md` の日英の表に足す。文書の決まりの試験が、表の揃いを確かめる):

  | 名前 | 重さ | 文 (日本語) | 文 (英語) | args |
  |---|---|---|---|---|
  | `layout/max-pages-reached` | info | `先頭の ${n} ページまで組み、そこで止めました (maxPages)` | `stopped after the first ${n} pages (maxPages)` | `maxPages` |
  | `layout/beyond-max-pages` | warning | `先頭の ${n} ページで止めたので、それより後ろを指す${種類} (${count} 件) が決まらず、"?" で組みました` (しおりは「飛び先の無いしおりにしました」、索引は「${n} ページまでの所だけを並べました」) | `stopped after the first ${n} pages, so ${count} ${kind}(s) pointing beyond them could not be resolved and were set as "?"` (同じく種類ごと) | `maxPages`・`kind`・`count`・`ids` (初めの 10 個) |

  `layout/beyond-max-pages` は、種類ごとに 1 件にまとめる (id ごとに出すと、目次の長い文書で数百件になる)。`warnings` (文の並び) にも同じ文を 1 つずつ入れる。
  `layout/not-converged` は、止めた文書でも、いまのとおり出す (止めたことで決まらない参照は、"?" で決まった値なので、収束を妨げない)。

### 2.5 結果に残るもの

- `pageCount`・領域の木の `sheets` は N ページ (文書が N ページ以下なら、止めずに全体。`truncated` は false で、結果は `maxPages` を渡さないときと同じ。
  文書がちょうど N+1 ページのときは、全体を組んでから N+1 ページ目を捨て、`truncated` は true)。
- `truncated: true`、`AreaTree.truncated = { maxPages }`、診断 `layout/max-pages-reached` (info) と、決まらない参照があれば `layout/beyond-max-pages`。
- `destinations` は、残した N ページの id だけ。構造の木 (タグ付き PDF) は、入力の節の並びから作るので、組まなかった節も含む:
  構造の木を、残したページに印の付いた節 (と、その祖先) に絞る (絞らないと、中身の無い構造の要素が並ぶ。pdfTags.ts の `used` の判定で、
  印の無い葉の要素はもう省いているので、その判定に乗る見込み。作る段で veraPDF で確かめる)。
- 進み具合: `phase: 'layout'` の `pages` は N まで。`phase: 'pdf'` の `total` は N。

### 2.6 メモリ節約・器の覚えとの関係

- メモリ節約 (`lowMemory`) とも合わせて使える: 組み直しの回・決まった回の組み直し (`replay`) のどれも、同じ所で止まる (2.1)。
- 器の覚え (書体の下ごしらえ `FontPrepCache`・段落の行分け `SharedLineMemo`) は、**覚えてよい。ただし世代を進めない** (推奨。7 の 6)。
  - 覚えの中身は、中身で引く (同じ段落・同じ書体なら同じ結果) ので、途中で止めた文書で覚えた段落も正しい。止めるのは改ページの所で、段落の行分けを覚える 1 回の書き込みの外。
  - 世代 (「いまの文書と前の文書で使ったもの」を残す数え方) は、止めた文書で進めない (`cancelDocument` を、止めた文書を組み終えたときに呼ぶ)。
    プレビュー (`maxPages`) を何度か組んでから全体を組む使い方で、前に全体を組んだときの後ろのページの段落の覚えを、プレビューの世代で捨てないため。
    止めた文書で使った段落は、次の文書の世代で使ったものとして残る (L1 の止める合図のときと同じ)。
- 組版の中の覚え (前の回の page-sequence の使い回し `seqMemo`) は、止めた page-sequence では作らない (2.1)。止めた位置より前の page-sequence は、いまのとおり使い回す。

## 3. 流し書きの作り

### 3.1 pdf-lib でできること・できないこと (1.17.1 を読んだ結果)

| こと | できるか | 中身 |
|---|---|---|
| 保存をページごとに書く | できない | `PDFDocument.save` は、`flush` (書体・画像の埋め込み) の後、`PDFStreamWriter.serializeToBuffer` で、全部のオブジェクトの大きさを数え、1 つの `Uint8Array` を作って書く。途中で外へ渡す口は無い |
| 書いたオブジェクトを捨てる | 口はある | `PDFContext.delete(ref)` で、文書からオブジェクトを除ける。番号 (`largestObjectNumber`) は戻らないので、後の番号は変わらない |
| 1 つのオブジェクトを書く | できる | オブジェクトは `sizeInBytes()`・`copyBytesInto(buf, off)` を持つ。保存と同じ形 (`n 0 obj\n…\nendobj\n\n`) は、`PDFWriter` の数行と同じに書ける |
| 相互参照の流れ・オブジェクトの流れ | 部品はある | `PDFCrossRefStream` (`addUncompressedEntry`・`addCompressedEntry`)・`PDFObjectStream.withContextAndObjects`・`PDFHeader.forVersion`・`PDFTrailer.forLastCrossRefSectionOffset` が公開されている (`pdf-lib` の core) |
| 増分の保存 (ISO 32000-2 §7.5.6) | 無い | 書き足しの保存は無い。あっても、前の版を読み直すので、メモリは下がらない |
| ページの中身を早く閉じる | Kumiori が足した | `sealPageContents` (pdfLibPatches.ts) が、描き終えたページの命令を、保存のときと同じに圧縮したバイト列 (`PDFRawStream`) にしている (いまも) |
| 画像を早く埋め込む | できる | `embedJpg`・`embedPng` は、番号だけを取り、中身は `flush` で作る (遅い埋め込み)。`PDFImage.embed()` を先に呼べば、その場で作る。JPEG は番号を足さないので、先に作っても同じ PDF。pdf-lib の PNG の埋め込みで α のあるもの (色の表の PNG の tRNS・16 ビット・飛び越しの α 付き) は、埋め込むときに SMask の番号を取るので、先に作ると後の番号がずれる (Kumiori の自前の埋め込み `embedPngAsIs`・`decodedPngEmbedder` は、もう、その場で作っている) |

保存の書き方 (`PDFStreamWriter`。Kumiori はふつうの PDF で使う): 見出し (`%PDF-1.7`) → 流れ (stream) のオブジェクトを番号の順に → 流れでないオブジェクトを
50 個ずつのオブジェクトの流れ (ISO 32000-2 §7.5.7) にまとめたもの → 相互参照の流れ (§7.5.8) → trailer。
相互参照の流れはオブジェクトの位置を持つので、オブジェクトの並びは自由 (§7.5.8 の表は位置で引く)。

### 3.2 代わりの作り: 保存と同じ書き方で、先に書けるものを先に書く

新しいモジュール `src/pdfStreamOut.ts`:

```ts
/** PDF を書き出し先へ流して書くもの (保存 PDFDocument.save と同じ書き方) */
class PdfStreamOut {
  constructor(pdf: PDFDocument, output: PdfOutput, opts: { deflate?: (d: Uint8Array) => Uint8Array });
  /** 書き終えた流れを、書き出し先へ書いて、文書から除く (先に書けるものの決まりは下) */
  release(ref: PDFRef): void;
  /** たまった塊を書き出し先へ渡す (ページの終わり。関数の書き出し先が Promise を返すときと、WritableStream は待つ) */
  drain(): void | Promise<void>;
  /** 残りのオブジェクト・オブジェクトの流れ・相互参照の流れ・trailer を書く (save と同じ: addDefaultPage・updateFieldAppearances・flush の後) */
  finish(): Promise<number>;
  /** 書き出し先を止める (WritableStream は abort) */
  abort(reason: unknown): Promise<void>;
}
```

- **先に書くのは、決まった流れだけ (許した物の一覧で決める)。** 描き手 (`renderPdfPages`) が、書き終えたと分かっている所で `release` を呼ぶ:
  - ページの中身の流れ: `sealPageContents` の後。
  - 画像の XObject: `embedImages` で埋め込んだ直後 (JPEG は `PDFImage.embed()` を先に呼んでから)。SMask も。
  - Form XObject (SVG の描き置き・色つきの字形の Form・模様): 作った直後 (`sealContentStream` を通るもの)。ただし、タグ付き PDF で中に印の付いた内容を持つ Form は除く
    (`PdfTagger.finish` が、最後に `StructParents` を辞書に足す。ISO 32000-1 §14.7.4.2)。
  - 一覧の外の流れ (書体のファイル・ToUnicode・XMP のメタデータ・注釈の見た目・フォームの欄の見た目など) と、流れでないオブジェクト (辞書・配列) は、最後に書く
    (多くは最後に作られ、辞書は後で書き足されるもの (ページの `Annots`・`StructParents` など) がある)。
  - pdf-lib の PNG の埋め込み (α 付き) の画像は、いまのとおり遅い埋め込みのまま最後に書く (先に作ると番号がずれる)。
- 書くときの形は、保存と同じ: `n 0 obj\n` + `copyBytesInto` + `\nendobj\n\n`。PDF の圧縮の差し替え (`useDeflate`。`deflate` を渡したとき、最後に
  `PDFFlateStream` の圧縮を替える) は、先に書く `PDFFlateStream` にも、書く時に同じに当てる (最後に当てるのと同じバイト列)。
- 書いたら、その流れの位置を覚え (`Map<番号, 位置>`)、`context.delete(ref)` で文書から除く。除いた後で引かれたら (pdf-lib か Kumiori が中身を読みに来たら)、
  `lookup` は `undefined` を返して、誤りに気付ける (黙って空のものを書かない)。試験で、全部の機能を使う文書で確かめる (5 の 2)。
- `finish`: `save()` と同じ前の手順 (`addDefaultPage`・`updateFieldAppearances`・`flush`) を踏んでから、`PDFStreamWriter.computeBufferSize` と同じ計算を、
  始まりの位置を「先に書いたバイト数」にして行う: 残りの流れを番号の順に → 流れでないオブジェクトを番号の順に 50 個ずつのオブジェクトの流れに
  (先に書いたのは流れだけなので、まとめ方は保存と同じ) → 相互参照の流れ (先に書いた流れの位置も、番号の順に入れる) → trailer。
  pdf-lib の `PDFStreamWriter` の約 100 行を、オフセットの始まりを変えられる形で写す (pdf-lib を書き換えない)。
- 見出し: `%PDF-1.7` と 2 進の印の行 (`PDFHeader.forVersion(1, 7)`)。PDF/X は流し書きでは使わない (4 の 3) ので、版の書き換えは要らない。
- **出来る PDF**: 流さない PDF と、同じ番号の同じオブジェクトを持つ (中身のバイト列も同じ)。違いうるのは、オブジェクトの並びと、相互参照の流れの位置の値だけ。
  先に書いた流れが、どれも、最後に書く流れより小さい番号なら、並びも同じになり、ファイルのバイト列まで同じになる
  (多くの文書がそう。最後に書く流れのうち小さい番号のものは、タグ付き PDF の印を持つ Form と、α 付きの pdf-lib の PNG の画像)。7 の 3 で決める。
- ファイルの識別子 (trailer の `ID`) と日時は、いまのとおり最後に決める (trailer は最後に書く)。

### 3.3 文書の全体を見ているものとの両立

| もの | いまの作り | 流し書きでの扱い |
|---|---|---|
| 書体の埋め込み (部分書体) | 先のたどり (`scan`) で使う書体を集めて `embedFont` し、字は描くときに `encodeText` で集まり、`flush` で部分書体を作る | 変えない。書体の流れは最後に書く (部分書体は全ページの字を見てから作る)。書体のファイルは `FontManager` が持っているので、PDF の側で増えるのは部分書体の分だけ |
| 色つきの字形 (Type 3) | 描くときに字の手順 (CharProcs) を作り、`colorGlyphs.finish` で書体の辞書を作る | 字の手順の流れは、作った直後に先に書ける (一覧に入れる)。辞書は最後 |
| 縦書きの書体の辞書 | 最後に `flush` してから作る | 変えない (最後) |
| 画像 | 描く前に全部を埋め込む (`embedImages`) | 埋め込んだ直後に 1 つずつ先に書いて除く (いちばん大きい画像 1 つ分しか持たない) |
| しおり | 最後に `addOutline` | 変えない (辞書。最後) |
| リンク・注釈・フォームの欄 | 最後に `addAnnotations`・`addFormFields` (ページの辞書の `Annots` に足す) | 変えない (ページの辞書は最後に書くので、後から足せる) |
| タグ付き PDF の構造の木 | ページごとに印 (MCID) を付け、最後に `PdfTagger.finish` で StructElem・ParentTree を作る | 変えない。ページの中身の流れは先に書けるが、ページの辞書 (`StructParents`) と構造の木は最後。印を持つ Form は最後 (3.2) |
| PDF/UA-1 の検査 | 最後に足りないものを警告 | 変えない (書いた PDF を読み直さない) |
| PDF/X・PDF/A の後の検査 | 書き出した PDF の全体を読み直して調べ、合わなければ投げる (`verifyStandard`・`verifyStandardA`) | 流し書きでは使わない (4 の 3) |
| PDF/X-1a・X-3 の透明の平らにする処理 | 平らにする所を、文書ごとに集めてから描く | 同上 |
| 進み具合・止める合図 | ページごと (L1) | 同じ。書き出し先への書き込みは、ページの間の間 (`pause`) の所で待つ |

### 3.4 メモリの見積もりと、測る方法

測った値 (この覚え書きのために、使い捨ての道具で測った。`typesetToPdf`。進み具合の呼び返しと 20ms ごとに `process.memoryUsage()` を見た山。Node 22):

| 文書 | ページ | PDF | ヒープの山 | 外のバイト列 (arrayBuffers) の山 | PDF の流れの内訳 |
|---|---|---|---|---|---|
| 対応仕様説明書 (XSL-FO) | 100 | 1.1MB | 577MB | 192MB (書体のファイルなど。組む前から 107MB) | 書体 337KB・画像 66KB・Form 61KB・ページの中身など 468KB |
| 対応仕様説明書 (HTML) | 147 | 1.7MB | 748MB | 287MB (組む前から 172MB) | 書体 482KB・画像 66KB・Form 82KB・ページの中身など 835KB |
| 文だけの文書 (節 6,000。作ったもの) | 1,600 | 3.8MB | 1,548MB | 82MB | 書体 13KB・ページの中身など 2.8MB |

- ヒープの山は、組版を終えて PDF を書き始める所 (全ページの論理の木を持つ所) にある。PDF の側で持つのは、PDF の大きさの 2 倍ほど (流れの全部と、保存の配列) で、
  これらの文書では山の 1% に満たない。**流し書きで下がるのは、PDF の大きさ × 2 から、書体・辞書の分と塊 (64KB) を引いた分。**
- 画像の多い文書の見積もり (測っていない。作る段で測る): 画像の合わせて I、ページの中身 C、書体 F、そのほか O の PDF で、いまは描き始める前に画像を全部埋め込むので、
  PDF の側の山は I + C + F + O + 保存の配列 (I + C + F + O) ≈ 2 × PDF。流し書きでは、いちばん大きい画像 1 つ + F + O + 塊。
  例えば写真の多い 500MB の PDF なら、PDF の側が 1GB ほどから、数十 MB になる見込み。入力の画像のバイト列 (画像の置き場 `AssetStore`) は、
  いまも PDF だけを作るときは埋め込んだら捨てている (`releaseImageBytes`) が、組む前に全部を読み込んでいるので、そこは変わらない (後の課題)。
- 測る方法: `scripts/measure-memory.mjs` を足す (作る段のコミット 4)。文書 (対応仕様説明書の 2 つ・文だけの文書・画像の多い文書 (pngjs で作る、
  圧縮の効かない画像 200 枚)・あれば CSS-Print と見本の FO) を、`typesetToPdf` と `typesetToPdfStream` (書き出し先は `fs.writeSync`)、
  `lowMemory` の有り無しで組み、`--expose-gc` で始めに片付けてから、ヒープ・arrayBuffers・RSS の山と、PDF を書く間の山と、時間を出す。
  時間の測りの道具 (別の束で作っているもの) があれば、その道具の一つの測り方として足す。結果は、この覚え書きの 8 (作った段) に書く。

### 3.5 メモリ節約 (`lowMemory`) との関係

- 置き換えずに、足す (別々のものを下げる)。メモリ節約は組版の側 (前の回のページの論理の木) を下げ、流し書きは PDF の側を下げる。合わせて使える。
- メモリ節約の決まった回の組み直し (`paint` の `replay`) は、同期の組版の中から、page-sequence を組み終えるごとにページを渡すので、ページの間で待てない。
  そのため、書き出し先が Promise を返す関数か `WritableStream` のときは、塊を、次に待てる所 (page-sequence の境目。`runPaced` で待つ) まで、ためる。
  HTML (page-sequence が 1 つ) では、文書の終わりまで、ためることになる (それでも、ためるのは圧縮したバイト列で、いまの PDF の側と同じかそれより小さい)。
  値を返さない関数 (`fs.writeSync` など) なら、ためずにページごとに書ける。`docs/library.md` に、メモリ節約と合わせるときは同期の書き出し先を勧める、と書く。

## 4. 安全と上限

1. **止める合図 (L1 の `signal`) で止めたとき**: いまのとおり、ページを描く前と保存の前で確かめる。止めたら、書き出し先を止め (`WritableStream` は `abort(理由)`、
   関数は何もしない)、返す Promise を理由で失敗にする。書き出し先には、途中までのバイト列が残る (PDF として読めない)。
   コマンドは一時のファイルを消す。`docs/library.md` に「流し書きを止めたり失敗したりしたら、書き出し先の中身は捨てる」と書く。
2. **書き出し先の誤り** (書き込みの失敗・`WritableStream` が誤りになった): 組版と書き出しを止め、その誤りをそのまま投げる (包まない。止める合図の理由と同じ考え)。
   ほかの書き出し先を `abort` しない (誤りになった書き出し先は、もう止まっている)。
3. **PDF/X・PDF/A** は、流し書きでは使えない (推奨。7 の 4): 後の検査が書いた PDF の全体を読み直し、合わなければ「規格の印の付いた PDF を返さない」ので、
   先に書いてしまうと、その約束を守れない。PDF/X-1a・X-3 の平らにする処理も、文書ごとに集めてから描く。
   `typesetToPdfStream`・`toPdfStream` に `pdfx`・`pdfa` を渡したら、何も書く前に `KumioriOptionError` (`api/invalid-option`。文は「PDF/X・PDF/A は流して書けません。typesetToPdf を使ってください」)。
   PDF/UA-1・タグ付き PDF は使える (後の検査が無い)。
4. **何も書く前に分かる誤りは、書く前に投げる**: 見出しは、最初のページを描き終えてから書く (タグ付き PDF の組み合わせの誤り・`pdfua/requires-tagged` などは、
   いまも描く前に投げているので、書き出し先は空のまま失敗する)。
5. **上限 (L2 の `limits`)**: 流し書きで変わる上限は無い (入力の上限は組む前・組む間に効き、書き出す大きさの上限は、いまも無い)。
   `maxPages` は上限ではない (超えても誤りにせず、そこまでを返す)。「N ページを超える文書を断りたい」サーバーは、`truncated` を見て断る (`docs/library.md` に書く)。
   脚注・float の続きのために足すページの守り (`ContinuationGuard`) は、いまのまま。
6. **同時に走る呼び出し**: 書き出し先は呼び出しごと。`PdfStreamOut` は呼び出しごとに作る。言語・上限は、いまの `CallContext` のまま (流し書きの await も `rejoin(thisCall(), await …)` の形にする。
   `test/callContextAwait.test.ts` が確かめる)。

## 5. 試験の案と、組版の結果が変わらないことの確かめ方

1. **maxPages のページが、全体を組んだときと同じこと** (`test/maxPages.test.ts`):
   - 前への参照も後ろへの参照も無い文書 (1 段・段組・脚注・float・表のページをまたぐもの・条件付きのマスター (`last`・`rest`)・`force-page-count`・
     メモリ節約) で、N = 1・2・ページ数 − 1・ページ数・ページ数 + 1 のとき、残したページの領域の木 (`serializeAreaTree` のページごと) が、全体を組んだ木の先頭 N ページと同じ。
   - 文書が N ページ以下なら、`maxPages` を渡さないときと、木・PDF のバイト列が同じで、`truncated` が false。
   - 止めるのは置くページだけで、組んでみるだけの組版 (段組の釣り合わせ・keep の試し組み) では止まらないこと (段の釣り合わせのある文書で、N を変えて確かめる)。
   - 道具 `scripts/check-max-pages.mjs` (作る段のコミット 2): 手元の見本 (アンテナハウスのサンプル FO 集・CSS-Print・WeasyPrint の見本) とリポジトリの文書を、全体と N = 1・3・10 で組み、
     先頭 N ページの指紋 (領域の木の指紋の試験と同じ作り方のページごとのもの) を比べ、違うページを、決まらない参照のある行かどうかで分けて一覧にする。
     違いが参照の字の所のほかにあれば、直す。
2. **決まらない参照の警告**: 目次 (前のページから後ろのページへの `page-number-citation`)・`page-number-citation-last`・`counter(pages)`・`target-counter()`・索引・しおりのある
   XSL-FO と HTML の文書で、N の前後に参照先を置き、"?" (WeasyPrint の組み方では空) になること、種類ごとに 1 件の `layout/beyond-max-pages`、
   文書に無い id は `layout/missing-id` のままであること、収束の判定が回の数を増やさないこと。
3. **流し書きの PDF** (`test/pdfStream.test.ts`):
   - `toPdf()` と `toPdfStream()` (日時と識別子は止めた値) が、同じ番号の同じオブジェクトを持つ (両方を pdf-lib で読み、番号ごとにオブジェクトのバイト列を比べる)。
     画像 (JPEG・PNG の各形)・SVG・色つきの字・グラデーション・リンク・しおり・フォームの欄・添付・縦書き・タグ付き PDF・PDF/UA-1・`deflate` を含む文書で。
   - 最後に書く流れの無い文書では、ファイルのバイト列まで同じ。
   - 書き出し先の 3 つの形 (`WritableStream`・Promise を返す関数・値を返さない関数) と、`lowMemory` の有り無しで同じ。
   - 先に書いて除いたオブジェクトを、後で引く所が無いこと (除いたものを引いたら誤りにする試験用の切り替えで、上の文書を通す)。
   - 止める合図: ページの途中で止めたら、`WritableStream` が理由で `abort` され、Promise が理由で失敗する。書き出し先の誤りは、そのまま返る。
   - PDF/X・PDF/A は、何も書かずに `KumioriOptionError`。
   - 背圧: 遅い `WritableStream` (highWaterMark 1) で、ためる塊がページ 1 枚分ほどを超えないこと。
4. **渡さないときに変わらないこと**: `npm run compare:base -- --base <変える前の main> --head .` で、リポジトリの文書と手元の見本の組版の結果が、どれも変わらないこと
   (`maxPages` も流し書きも渡さないので、変わった文書が無いことを確かめる)。領域の木の指紋の試験 (`test/fingerprints/`) が書き直さずに通ること。
   コマンドは流して書くようになるので、`npm run compare:base` の PDF の比べ (コマンドの出力で比べている所があれば) でも、PDF のバイト列が変わらないことを見る。
5. **速さ**: `maxPages` を渡さないときと、流し書きを使わない `typesetToPdf` の速さが変わらないこと (L1 の 2.3 と同じ測り方。`notePage` に比べが 1 つ増えるだけ)。
   流し書きの時間 (書き出し先が速いとき、保存の配列を作らない分、少し速くなる見込み) と、`maxPages: 3` の時間を、この覚え書きに書く。
6. **タグ付き PDF**: `maxPages` で止めた文書と、流し書きの文書を、`--tagged` で組んで `node scripts/verapdf.mjs` にかけ、落ちる規則が、止めない・流さない PDF と同じこと。
   `pdfinfo -struct-text` で構造の木を見る (止めた文書の構造の木が、残したページの分に絞られていること)。

## 6. 大きさの見積もりと、作る段の分け方

| コミット | 中身 | 大きさ (見込み) |
|---|---|---|
| 1 | `maxPages` の組版の本体: `notePage` で止める印・`onceSteps` で受ける所・`seqBuilding`・見張りのページ・N より後ろの id の集まり・"?" と警告・`truncated`・診断の表 (`diagnostics.ts`・`docs/diagnostics.md` の日英)・選択肢の検査・器の世代・試験 (5 の 1・2) | コード 250 行・試験 300 行 |
| 2 | `maxPages` の外側: 構造の木の絞り込み・コマンドの `--max-pages`・`docs/library.md`・`docs/cli.md` の日英・CHANGELOG の日英・`scripts/check-max-pages.mjs` とその結果・速さ | コード 100 行・道具 150 行・文書 150 行 |
| 3 | 流し書きの書き手 (`src/pdfStreamOut.ts`): 保存の書き方の写し・先に書く一覧 (`release`)・塊・書き出し先の 3 つの形・止める・誤り。`renderPdfPages` に入れる (流さないときは、いまのまま `pdf.save()`)・試験 (5 の 3) | コード 350 行・試験 300 行 |
| 4 | 流し書きの口: `typesetToPdfStream`・器の版・`toPdfStream`・PDF/X・PDF/A の誤り・コマンドの一時のファイルへの流し書き・`scripts/measure-memory.mjs` と測った値・文書 (`docs/library.md`・`docs/cli.md`・CHANGELOG の日英) | コード 200 行・道具 150 行・試験 150 行・文書 150 行 |

- 合わせて、コード 900 行・試験 750 行・道具 300 行・文書 300 行ほど。1〜2 (`maxPages`) と 3〜4 (流し書き) は、分けて main に入れられる (どちらを先にしてもよい)。
- どのコミットも、渡さないときの組版の結果と PDF は変えない (5 の 4)。コミット 4 でコマンドが流して書くようになる所は、PDF のバイト列が同じことを試験で確かめる。

## 7. 決めてほしいこと (推奨を最初に)

1. **組み直しの回ごとの止め方**
   - (推奨) どの回も、同じ N (見張りの N+1 ページまで組む) で止める。速いが、N ページより後ろを指す参照は "?" になる
   - 1 回目だけ全体を組んで参照の値を決め、2 回目から N で止める。参照の値はほぼ正しくなるが、全体を 1 度組むので、プレビューの速さにならない
2. **決まらない参照の字**
   - (推奨) "?" (いまの見つからない id と同じ。WeasyPrint の組み方では空)
   - 1 回目の仮の値 (参照しているページの番号) のまま。もっともらしい数になるが、違う番号を見せる
   - 空
3. **流し書きの PDF と、流さない PDF の同じさ**
   - (推奨) 同じ番号の同じオブジェクト (中身のバイト列も同じ) を持つことを約束し、並びは違ってよいとする。書き終えた流れは、すぐ書いて手放す。
     最後に書く流れ (タグ付き PDF の印を持つ Form・α 付きの pdf-lib の PNG) が無い文書は、ファイルのバイト列まで同じ
   - ファイルのバイト列まで同じにする。最後に書く流れより大きい番号の流れは、先に書かずに持つ (その文書では、メモリがほとんど下がらない。タグ付き PDF で SVG に字のある文書など)
4. **PDF/X・PDF/A と流し書き**
   - (推奨) 使えない (何も書く前に `KumioriOptionError`)。コマンドは、`--pdfx`・`--pdfa` のときは流さずに書く
   - 全体を作ってから、書き出し先へ流す (使えるが、メモリは下がらない。info の診断で知らせる)
   - 書いた後で、書き出し先 (Node のファイル) を読み直して調べる (Node だけ。合わなければファイルを消して投げる)。ブラウザでは使えない
5. **コマンドの流し書き**
   - (推奨) 選択肢を足さずに、PDF (`--pdfx`・`--pdfa` のほか) はいつも流して書く。一時のファイルに書き、書き終えたら名前を替える (PDF は同じバイト列か、同じオブジェクト)
   - `--stream` を足し、付けたときだけ流す
   - コマンドは流さない (API だけ)
6. **途中で止めた文書と、器の覚えの世代**
   - (推奨) 覚えは残し、世代は進めない (止める合図で止めた文書と同じ)。プレビューを何度組んでも、前に全体を組んだ文書の覚えを捨てない
   - ふつうの文書と同じに世代を進める (作りが簡単。プレビューの後に全体を組むと、後ろのページの段落の覚えが捨てられていることがある)
7. **`maxPages` を `CallContext` に載せるか**
   - (推奨) 載せない。`LayoutOptions.maxPages` で `LayoutEngine` に渡す (読むのは 1 か所。L1 の覚え書きの 8.2 の見込みを、この覚え書きで改める)
   - 載せる (上限・言語と同じ置き場。深い所で読む必要は、いまは無い)

## 8. 1〜N ページが全体を組んだときと同じになる条件

取りまとめ役に尋ねられて、2.2 の「結果の正しさ」を詳しくしたもの。

- **同じになる** (領域の木の 1〜N ページが、全体を組んだときと同じ): 1〜N ページの本文に、N より後ろを指すもの
  (ページ番号の参照・最後のページの番号・本文の中の総ページ数・索引の並び) が無いとき。0 の「ページ N は N+1 を作った時に決まっている」と、見張りのページによる。
  柱 (static-content・ページの余白の箱) の中の参照だけなら、その字が "?" になるだけで、本文の組み (行分け・改ページ) は同じ
  (柱の領域の大きさは中身で変わらない)。
- **同じにならない**:
  - 1〜N ページの本文に、N より後ろを指す参照がある。その字は、いつも "?" になる (木が違う)。さらに、"?" と本当の数の幅の違いで、その行の分け方が変わり、
    後ろの行・1〜N の中の改ページがずれることがある。
    - 目次で、リーダー (`fo:leader`・CSS の `leader()`) の後ろに右寄せでページ番号を置く形は、幅の違いをリーダーが吸うので、行分けはまず変わらない
      (項目の題が長く、番号の幅の違いで折り返しが変わる行だけ)。
    - 本文の中の「…ページを見よ」・リーダーの無い目次 (`target-counter()` を字の後ろに続ける形) は、その段落の行分けが変わりうる。
    - 前付けに目次のある本・説明書を N = 3 などで組むと、目次の番号は "?" になる (よくある)。行分けまで変わる文書がどのくらいあるかは測っていない。
      作る段で `scripts/check-max-pages.mjs` (5 の 1) で、手元の見本を数える。
  - 1〜N ページに索引の並びがある (N より後ろの所が抜ける)。
  - 段組の並びの、脚注・前方 float の予約の組み直しが、全体を組んだときに回数の上限 (16 回) で終わる文書。前から固める作りなので、1〜N は同じになる見込みだが、
    確かめていない (試験で確かめる)。
  - 木の外では、しおり・リンクの飛び先 (`destinations`) が、N より後ろを指すものだけ無い。
- **「1 回目だけ全体を組む」(7 の 1 の 2 つ目の候補) でも、必ず同じにはならない。** 2 回目から N で止めると、N より後ろの id のページは、1 回目の値のまま
  (2 回目に後ろのページがずれても、組まないので分からない)。全体を組んだときは、2 回目でずれたら 3 回目を組んで値を直す。
  - 同じになるのは、全体を組んだときに、1 回目の後の値で決まる (2 回目の組版で、1〜N ページから指す id のページが変わらない) とき。
  - 前付けに目次のある文書は、1 回目の仮の値 (いまのページの番号) と本当の番号の桁の違いで、2 回目に目次の行が増減し、後ろが全部ずれることがあり、
    そのときは古い番号を組む (違う番号を見せる。"?" より悪い)。
  - 必ず同じにするには、全体を収束まで組むしかない (それは止めないのと同じ手間)。

## 9. 決めたこと

- 2026-11-22 (利用者の決め。取りまとめ役から): **PDF の流し書きは 0.7.0 に送った。** 0.6.0 では `maxPages` だけを作る。
  1.2・1.3 の流し書きの所・3 節・4 節・5 の 3・6 のコミット 3〜4・7 の 3〜5 は、0.7.0 のための調べとして残す。
- 2026-11-22 (同): 決まらない参照の字は "?" (7 の 2 の推奨。WeasyPrint の組み方では空のまま)。
- 2026-11-22 (同。8 節の説明の後): 組み直しの回は、どの回も N で止める (7 の 1 の推奨)。後ろを指す参照は "?" で、警告を種類ごとに 1 件。
  `docs/library.md`・`docs/cli.md` (日英) に、後ろを指す参照のあるページは全体と行分けが違うことがあること・8 節の条件の要約・読み込みとカスケードは全体のままであることを書く。
- 同: そのほかは、どれも推奨のとおり。`truncated` (`TypesetResult`・`TypesetPdfResult`・`AreaTree`)、診断 `layout/max-pages-reached` (info)・`layout/beyond-max-pages` (warning)、
  コマンドの `--max-pages`、止めた文書の器の覚えは残して世代を進めない、`CallContext` に載せず `LayoutOptions.maxPages` で渡す。
- 作る段は、6 のコミット 1〜2 (maxPages) だけ。
- 2026-11-23 (0.7.0 の決め D-067): PDF の流し書きは、この覚え書きの 3 節の調べを元に `design/pdf-writer.md` で設計し直し、そこに決めを書いた
  (書き出し先は `WritableStream` と塊を受ける関数・PDF/X と PDF/A は流せない・コマンドはいつも一時のファイルに流して名前を替える、など)。
  1.2 の口の案のうち、入ったのは `typesetToPdfStream`・器の `typesetToPdfStream`・`TypesetResult.toPdfStream` (`design/pdf-writer.md` の 3.1・9)。

## 10. 作った段

- コミット 1 (maxPages の本体と API): `LayoutOptions.maxPages`・`notePage` が N + 2 ページ目を作った所で投げる印 `PAGE_LIMIT`・
  `onceSteps` (1 段) と `layoutColumnPass` (段組) で受ける所・`cutPages` (N ページを残し、見張りのページの id から「後ろにある id」「後ろへ続く id」を分ける)・
  決まらない参照の字 (`cite`・柱の `{totalPages}`)・しおり・索引の警告・`AreaTree.truncated`・`TypesetResult.truncated`・`TypesetPdfResult.truncated`・
  選択肢の検査・器の世代 (止めた文書を組み終えたら `cancelDocument`)・診断の表 (日英)・`docs/library.md` (日英) の節。
  - 2 の作りから変えた所:
    - 段組の page-sequence は、脚注・前方 float の予約を決めるために `layoutColumnPass` を何回も組む。止める印は `layoutColumnPass` の中で受け、
      そこまでのページに脚注・前方 float を置いて返し、予約の組み直しの繰り返しを続ける (外へ投げると、組み直しが途中で終わり、1〜N ページが変わった)。
      回ごとに止めたかを数え直す (前の回で止まっても、この回で止まらなければ止めない)。脚注の続きのために足すページも、見張りのページより後ろには作らない
      (作ると N + 2 ページ目で投げ、組み直しが途中で終わった。文書が見張りのページで終わる N = ページ数 − 1 の試験で見つけた)。
    - 文書がちょうど N + 1 ページで終わった (N + 2 ページ目を作らなかった) ときも、見張りのページを捨てて止めた扱いにする (2.5 のとおり)。
    - メモリ節約の、page-sequence を組み終えるごとにページを渡す所は、見張りのページを渡さない。
    - 抜けた後に同じ host で柱を組むので、流れの手間の数え (入れ子の深さ・測りの中か) を戻す (`resetFlowDepth`)。
    - 見張りのページを組む間の警告は除く (1 段の page-sequence で投げたとき)。段組では、脚注の溢れの警告を後でまとめて出すので除かない。
  - 試験: `test/maxPages.test.ts` (5 の 1・2 と、器の世代・選択肢の検査)。段組の予約の組み直しが回数の上限で終わる文書は、
    予約の選び方 (`ColumnReservePlan.choose`) を、試した数で振らせて決まらないようにして確かめた (この形で 16 回まで組み、1〜N ページが同じ)。
  - 確かめ: `npm test` (344 ファイル・5,874 件。領域の木の指紋は書き直さずに通る)。渡さないときに組版が変わらないことは、下の組み比べ。
- コミット 2 (コマンドと道具): コマンドの `--max-pages <N>` (報告の行に「`--max-pages N で止めた`」)、`docs/cli.md`・`docs/development.md`・CHANGELOG の日英、
  `scripts/check-max-pages.mjs` (5 の 1 の道具)。試験: `test/cli.test.ts` の `--max-pages` (PDF・SVG・N より後ろを指す `--pages` の誤り・値の検査)。
  - `scripts/check-max-pages.mjs` の結果 (N = 1・3・10。既定の書体で組んだ。アンテナハウスのサンプル FO 集 216・CSS-Print・WeasyPrint の見本 8・
    対応仕様説明書 2 の 227 文書のうち、N より多いページの文書を、止めて組んだ回 133 回、比べたページ 243 枚):
    同じ 217 枚、参照の字だけ違う 22 枚、行分けまで変わった 4 枚、絵だけ違う 0 枚。後ろを指す参照の警告が無いのに違うページは 0 枚。
    - 参照の字だけ: 目次 (対応仕様説明書・CSS-Print・WeasyPrint の book・report の目次の番号が "?" または空)、柱の総ページ数、
      アンテナハウスの見本の `axf-origin-id-1`・`page-number-citation-1`・`page-number-format-1`。
    - 行分けまで変わった 4 枚は、どれも本文の中の参照 (8 節のとおり): `ah/axf-page-sequence-1` の 1 ページ目 (「2 ページ目は…」の番号)、
      `ah/table-keep-together-overflow-1` の 1 ページ目と 9 ページ目 (「2 ページ目の表は…」「11 ページ目は…」)、CSS-Print の 4 ページ目
      (本文の中の「（ページ 57）」などの章の案内)。"?" の幅が数字より狭く、段落の行分けがずれた。
    - 道具を作る途中で、子のプロセスの出力をバイトの塊のまま文字列に足して、塊の境の字が壊れ、比べるたびに結果が揺れた
      (`setEncoding('utf8')` で直した)。`scripts/compare-base.mjs` の `run` も同じ書き方なので、字の比べが揺れることがありうる (別に直す)。
- 渡さないときに組版が変わらないこと: `npm run compare:base -- --base d98a199 --head <コミット 2>` (コミット 1〜2 の前の main と、main に載せ直す前のコミット 2) で、
  263 文書 (対応仕様説明書 4・examples 2・samples 2・generated 30・アンテナハウスの FO 集 216・CSS-Print・WeasyPrint の見本 8。既定の書体) の
  PDF のバイト列がどれも同じ。領域の木の指紋の試験も、書き直さずに通る。
- タグ付き PDF: 対応仕様説明書 (HTML) を `--tagged` で全体と `--max-pages 3` で組み、`node scripts/verapdf.mjs` にかけた。全体は PDF/UA-1 の規則 5 つ
  (7.1-8・7.1-10・7.3-1・7.4.2-1・7.7-1。`--pdfua` を付けていないので、文書の情報の規則も落ちる) が落ち、止めた PDF は 2 つ (7.1-8・7.1-10。全体でも落ちるもの)。
  止めて増えた規則は無い。構造の木 (`pdfinfo -struct`) は 7,509 行から 250 行になり、残したページの節だけになる (印の無い節を省く今の作りで絞られる。2.5)。
- 速さの例: 対応仕様説明書 (HTML。121 ページ) のコマンドの組版の時間が、全体 10,242ms・`--max-pages 3` 651ms (読み込み・カスケードの時間は入らない)。
- 0.7.0 (流し書き): `design/pdf-writer.md` の 8 (束 P1。自前の書き手) と 9 (束 P2。流し書きの口・コマンドの一時のファイル・メモリの測り) に書いた。
  測った値では、流して下がるのは画像の多い文書の PDF を書く間のメモリだけで、文の多い文書の山は組版の途中の木にある (`design/pdf-writer.md` の 9.1)。
