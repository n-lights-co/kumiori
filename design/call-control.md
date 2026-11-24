# 組版を途中で止める・進み具合を知らせる・呼び出しごとの言語の設計の覚え書き

組版の呼び出しに、止める合図 (`AbortSignal`) と進み具合の呼び返し (`onProgress`) を足し、警告・誤りの文の言語 (`lang`) を、
同時に走る呼び出しの間で混ざらないようにする設計です。9 の決めは、取りまとめ役と利用者が決めた (2026-11-22。どれも推奨のとおり)。
作るのは 7 の段の順で、10 に進み具合を書く。この覚え書きは、リリースする文書 (`docs/` など) ではありません。

前提にしたもの:

- 器 (`createTypesetter`) が、書体の下ごしらえと段落の行分けを文書をまたいで使い回す変更 (`design/relayout.md` の 7。main に入っている。
  `src/api.ts` の `buildTypesetter`・`src/fontManager.ts` の `FontPrepCache`・`src/layoutEngine.ts` の `SharedLineMemo`)。
- 利用者の決め: ページを組むたびと、画像・書体を読むたびに、止める合図を確かめる。組版の途中に間をあける (await を挟む) のは、
  `signal` か `onProgress` を渡したときだけ。止めたら `AbortError` の名前の `DOMException` を投げる。言語は、止める合図・進み具合と同じ
  「呼び出しごとの文脈」に持たせる (Node は `AsyncLocalStorage`、ブラウザは文脈を引数で渡す)。選択肢は足すだけで、渡さなければ前と同じに動く。
  組版の結果は変えない。

## 0. 先に分かったこと (設計の形を決めるもの)

- **組版の本体は、1 つの page-sequence の中で、同期の再帰で組む。** 改ページは、深い再帰 (`layoutChildren` → `layoutBlock` → … →
  `Flow` の溢れ) の中から、`layoutSequence` の `mkPage` (段組なら `layoutColumnSequence` の `nextPage`) を呼んで起きる。
  再帰の途中の状態は呼び出しのスタックにしかないので、**ページの境目で await を挟むことはできない**
  (挟むには、`Flow` を「ページの境目で止めて続きから組める」形にする必要がある。`design/relayout.md` の 4 の 2・5 の段階 4 と同じ作り替えで、大きく、危うさも大きい)。
- 同期の処理の途中では、イベントループが回らないので、外から `controller.abort()` を呼んでも、`signal.aborted` は変わらない
  (`AbortSignal.timeout()` も、タイマーのタスクが走るまで変わらない)。同期の途中の確かめが効くのは、**その確かめの前に利用者のコードが同期で走ったとき**、
  つまり `onProgress` の呼び返しの中で `abort()` を呼んだとき (自分で時間を見て止める使い方) と、await を挟んだ後。
- そこで、次の 2 つを分ける。
  - **確かめる所** (同期。`signal.aborted` を見るだけ): ページを作るたび・画像と書体を読むたび・PDF のページを書くたび。渡さなければ `undefined` の比べ 1 回。
  - **間をあける所** (await。`signal` か `onProgress` を渡したときだけ): 組版の段階の境目・資源の読み込み・組み直しの回 (pass) の境目・
    page-sequence の境目・PDF のページごと。1 つの page-sequence の中では間をあけない (上のとおり、あけられない)。
- いちばん長い「間の無い所」: HTML (名前付きページで分けなければ page-sequence は 1 つ) の 1 回の組版。対応仕様説明書 (HTML。151 ページ) で 3〜6 秒ほど
  (`design/relayout.md` の 2.2)。読み込み・カスケード (`importHtmlText` の中。同期) も 4〜5 秒ある。外からの `abort()` が効くのは、その後になる。
  ページごとに止めたいときは、`onProgress` の中で止める (4 の例)。これを `docs/library.md` に書く。

## 1. 公開する API の形

### 1.1 型

```ts
/** 進み具合 (onProgress に渡すもの) */
export interface TypesetProgress {
  /**
   * 段階。呼ぶ順はこの並び (使わない段階は飛ばす)。
   *  - 'fonts': 器を作るときの書体の読み込み (createTypesetter と、typeset・typesetToPdf の初め)。loaded / total は書体の数
   *  - 'resources': 文書の資源の読み込み (CSS・@font-face の書体・画像・数式などの書体)。loaded は読み終えた数 (total は分からないので無い)
   *  - 'import': 文書の読み込み・カスケード (HTML・XSL-FO を組版の木にする)。始まりに 1 回
   *  - 'layout': 組版。pass は組み直しの回 (1 から)、pages はその回で作ったページの数。ページを作るたびに 1 回
   *  - 'pdf': PDF の書き出し (toPdf・typesetToPdf)。pages は書いたページの数、total は総ページ数。ページを書くたびと、書き終えて保存する前に 1 回
   */
  phase: 'fonts' | 'resources' | 'import' | 'layout' | 'pdf';
  pass?: number;
  pages?: number;
  loaded?: number;
  total?: number;
}

export interface TypesetOptions {
  // … いまの選択肢 …
  /**
   * 組版を止める合図 (WHATWG DOM §3.2 の AbortSignal)。止めると、返す Promise は signal.reason で失敗する
   * (reason を渡さずに abort() したときは、AbortError の名前の DOMException)。渡したときは、組版の段階の境目・資源の読み込み・
   * 組み直しの回の境目で間をあける (await を挟む) ので、ほかの処理 (画面の描き直し・abort の呼び出し) が走れる。
   * 1 つの page-sequence の組版の途中では間をあけないので、そこで止めたいときは onProgress の中で abort() を呼ぶ
   */
  signal?: AbortSignal;
  /**
   * 進み具合の呼び返し (TypesetProgress)。同期で呼ぶ。投げた誤りは、組版を止めて、そのまま返す Promise の失敗にする。
   * 渡したときは、signal と同じ所で間をあける
   */
  onProgress?: (progress: TypesetProgress) => void;
}

export interface PdfOptions { /* … */ signal?: AbortSignal; onProgress?: (progress: TypesetProgress) => void }
export interface RenderPageSvgOptions { /* … */ signal?: AbortSignal }
export interface RenderPagePngOptions { /* … */ signal?: AbortSignal }

export type TypesetterOptions = Pick<TypesetOptions, 'fonts' | 'genericFonts' | 'loadFont' | 'fetchTimeoutMs' | 'deflate'> & {
  reuse?: boolean;
  /** 器を作る間 (既定の書体の取得と、fonts の書体の解析) の止める合図・進み具合。作った後の typeset には効かない */
  signal?: AbortSignal;
  onProgress?: (progress: TypesetProgress) => void;
};
```

- `TypesetterOptions` の `signal`・`onProgress` は、`Pick` に入れずに足す (入れると `DocumentOptions` (= `Omit<TypesetOptions, keyof TypesetterOptions>`) から
  消えて、`Typesetter.typeset` に渡せなくなる)。器の設定と文書の設定で、同じ名前を別の意味 (器を作る間・その文書を組む間) で持つ。
  `SETUP_ONLY_OPTIONS` (文書ごとの設定に渡すと警告する名前) には入れない。
- `resolveResource`・`loadFont` の呼び返しの第 2 引数に `{ signal }` を足す (足すだけなので、いまの関数はそのまま動く)。利用者が自分で読む取得も止められる。
  `signal` は、その呼び出しの合図と時限 (`fetchTimeoutMs`) を合わせたもの (`AbortSignal.any`。WHATWG DOM §3.2)。
- 既定: どれも省略。省けば、いまと同じ動き・同じ速さ (間をあけない)。

### 1.2 入口ごとの受け方

| 入口 | signal・onProgress を読む所 | 効く範囲 |
|---|---|---|
| `typeset`・`typesetHtml`・`typesetFo` | `options` | 書体の読み込みから組版の終わりまで。返した結果の `toPdf` などには効かない (下) |
| `typesetToPdf` | `options` (`pdf` には足さない) | 組版と PDF の書き出しの全部 (メモリ節約 `lowMemory` も) |
| `createTypesetter` | `setup` | 器を作る間だけ |
| `Typesetter.typeset`・`Typesetter.typesetToPdf` | 文書ごとの `options` | `typeset`・`typesetToPdf` と同じ。器の `setup.signal` は使わない |
| `result.toPdf` | `PdfOptions` | PDF の書き出し |
| `result.renderPageToSvg`・`renderPageToPng` | それぞれの設定 | そのページ (画像の読み・PNG の符号化の前後で確かめる) |
| `result.renderPage` (Canvas。同期) | 受けない | 1 ページを同期で描くので、止める所が無い |
| `kumiori/browser`・Web Worker の中 | 同じ (同じ `api.ts`) | 同じ。Worker の中では、親からの「止める」の知らせ (postMessage) が届くのは、間をあけた所だけ (4) |

- 結果の `toPdf` などが、組んだときの `signal` を引き継がないのは、組版を止める合図と、後で PDF を作るときの合図は別のもの
  (プレビューで組み終えた結果を、後で PDF にする) だから。言語は、いまと同じく組んだときのものを引き継ぐ (2 の文脈を覚えておく)。
- `onProgress` の回数の見積もり: ページ数 × 組み直しの回の数 (+ 条件付きのページのマスターの組み直し) + 資源の数 + PDF のページ数。
  151 ページの文書で 500 回ほど。同期で呼ぶだけなので、渡さないときの手間は無い。
- `phase: 'layout'` の `pages` は、組み直しの回ごとに 0 から数え直す (前の回のページ数を総数の目安にできる。`pass` で見分ける)。
  組んでみるだけの組版 (段組の釣り合わせ・`o.trial`・測るための組版 `typesetForeign`) のページは数えない。

### 1.3 コマンド

足さない。コマンドは 1 つの文書を組んで終わるので、止めるのはプロセスを止める (Ctrl-C・`timeout` コマンド・サーバーの上限) のがいちばん確かで、
いまもできる。進み具合の表示 (`--progress`) は、あれば便利だが、この束の決め (API の口) と別のことで、表示の形 (標準エラーに出す・1 行で上書きする) を決める必要がある。
足すなら後の束にする (8 の 4)。

## 2. 止める合図を確かめる所・間をあける所

新しいモジュール `src/callContext.ts` に、呼び出しの文脈 (3) と、確かめる関数を置く:

- `check()`: `signal?.aborted` なら `signal.throwIfAborted()` (WHATWG DOM §3.2: 理由 (reason) を投げる)。同期。
- `pause()`: 間をあける所。`pace` (signal か onProgress がある) でなければ何もしない (await もしない: 呼ぶ側は `if (ctx.pace) await ctx.pause()` と書き、
  渡さないときに Promise を作らない)。`pace` なら `check()` → 前に間をあけてから 16ms 以上たっていれば、1 度タスクを返す
  (`scheduler.yield()` があればそれ、無ければ `MessageChannel` (ブラウザ)・`setImmediate` (Node)。`setTimeout(0)` は入れ子で 4ms 待つので使わない) → `check()`。
- `progress(p)`: `onProgress` があれば呼び、続けて `check()` (呼び返しの中で `abort()` したら、すぐ止める)。

### 2.1 確かめる所の一覧

| 所 | ファイルと関数 | 確かめ | 間 |
|---|---|---|---|
| 入口 (始める前) | `api.ts` の `typeset`・`typesetToPdf`・`createTypesetter`・器の `typeset`・`typesetToPdf`・`toPdf`・`renderPageToSvg`・`renderPageToPng` | 始める前に `check()` (止めた合図を渡されたら、何も読まずに失敗する。WHATWG DOM §3.2.1 (API で AbortSignal を使うときの決まり) のとおり) | — |
| 器の書体 | `api.ts` の `buildTypesetter` の `bufferOfSpec` (`loadFont`・`fetchFont`) と `fonts` の解析の繰り返し | 書体ごとに `progress({ phase: 'fonts' })` | 書体ごと |
| 数式・等幅・記号・絵文字の書体 | `api.ts` の `loadOptional`・`loadSpec` | 読む前と後 | 読むたび (もともと await) |
| 文書の資源 | `api.ts` の `typesetDocument` の `collectResources`・`@font-face` の登録 (`fonts.registerBuffer`)・画像 (`assets.addBlob`・`fetchReportedImages`)・`mentionedFiles` の読み | 1 つ読むたびに `progress({ phase: 'resources' })` | 読むたび (もともと await) |
| 取得 | `resources.ts` の `fetchGuarded`・`api.ts` の `fetchFont`・`assets.ts` の取得 | `signal` を `fetch` に渡す (`AbortSignal.any([時限, 呼び出しの合図])`)。止めたら読みかけの応答も止まる | — |
| 読み込み | `api.ts` の `importHtmlText`・`importFo` の前後 | `progress({ phase: 'import' })` | 前後 |
| 組み直しの回 | `layoutEngine.ts` の `layoutPasses` の繰り返し | 回の初め | 回の境目 (下の 2.2) |
| page-sequence | `layoutEngine.ts` の `layoutOnce` の `doc.sequences.forEach` | sequence の初め | sequence の境目 (2.2) |
| ページ | `layoutEngine.ts` の `layoutSequence` の `mkPage`・`layoutColumnSequence` の `nextPage` (`ensurePage`)・`forcePageCount` の白ページ・条件付きのマスターの組み直し | `progress({ phase: 'layout', pass, pages })` (組んでみるだけの組版では呼ばない) | 無し (同期の再帰の中) |
| 柱など | `layoutEngine.ts` の `sheetStatics` の繰り返し | 10 ページごとに `check()` | 無し |
| PDF | `pdfRenderer.ts` の `renderPdfPages` の画像の埋め込み (`embedImages`)・書体の埋め込み・`src.paint` のページごと・`pdf.save` の前 | ページごとに `progress({ phase: 'pdf', pages, total })` | 画像・書体ごと (もともと await)・ページごと (下) |
| SVG・PNG | `api.ts` の `renderPageToSvg`・`renderPageToPng` (`svgRenderer.ts`・`pageRaster.ts` の画像の読み) | 画像ごと | 画像ごと (もともと await) |

- ページの確かめの口は、`LayoutEngine` の設定に足す `control?: LayoutControl` 1 つにまとめる:

  ```ts
  /** 組版の呼び出しの見張り (api.ts が作る。無ければ何もしない) */
  interface LayoutControl {
    /** ページを 1 枚作った (pass は組み直しの回、pages はその回のページ数)。止めるときは投げる */
    page(pass: number, pages: number): void;
    /** 回・page-sequence の境目。間をあけるときは Promise を返す (2.2) */
    boundary(): void | Promise<void>;
  }
  ```

  先頭から N ページで止める選択肢 (後の束) も、同じ `page` で数を見て止める (`page` が「この回はここで終える」の印を返すか、内向きの印の誤りを投げて
  `layoutOnce` で受ける)。そのため、`page` を呼ぶ所は「本当に置くページを作った所」に限り、組んでみるだけの組版では呼ばない、という決まりを、この束で決めて試験で守る
  (数がずれると、N ページで止める所がずれる)。

### 2.2 回と page-sequence の境目で間をあける作り

`layoutPasses`・`layoutOnce` は同期の関数で、`layout`・`layoutSheets`・`layoutLowMemory` から呼ばれる。これを、境目で `yield` する
ジェネレーター関数 (`*passSteps(doc)`・`*onceSteps(doc)`) に書き直し、走らせる側を 2 つにする:

- 同期で走らせる (`runSync(gen)`: `next()` を最後まで呼ぶだけ)。`control` が無いとき・`pace` でないとき。いまの `layout` などは、これで同じに動く。
- 非同期で走らせる (`runPaced(gen, control)`: `next()` ごとに `await control.boundary()`)。`layoutAsync`・`layoutSheetsAsync` を足し、`api.ts` は `pace` のときだけこちらを呼ぶ。

ジェネレーターの `yield` は、回と page-sequence の境目 (1 文書で数回〜数十回) だけなので、同期で走らせたときの手間は測れないほど小さい (下の 2.3 で確かめる)。
`forEach` の中の `return` (前の回の page-sequence を使い回す所) は、`for … of` の `continue` に直す。

メモリ節約 (`layoutLowMemory`) は、`renderPdfPages` が `scan`・`paint` で同期の呼び返しとして組ませるので、間はあけない (ページの確かめだけ)。
PDF の書き出しの、ページごとの間は、メモリ節約でないとき (`layoutSheets` の `sheet(i)` を順に描く) だけ、`renderPdfPages` の `src.paint` を、
間をあけられる形 (`paintPaced?`) にしてあける。

### 2.3 渡さないときに速さが変わらないことの確かめ方

- 道具: `scripts/profile-relayout.mjs` (`--no-profile`) に、`--signal` (止めない合図を渡す)・`--progress` (何もしない `onProgress`) を足す。
- 文書: `design/relayout.md` の 1 の html-spec・fo-spec・css-print。器を 1 つ作り、`reuse: false` で 6 回組み、2〜6 回目の typeset・toPdf の時間の中央値を見る。
- 比べるもの: (a) 変える前の main、(b) 変えた後で何も渡さない、(c) 変えた後で `signal` を渡す、(d) `onProgress` を渡す。
  (a) と (b) の差が揺れ (±10%) の中で、交互に 3 組測って中央値の差が 2% 以内なら、速さは変わらないとみる。
  (c)・(d) は、間をあける手間 (1 文書で数十回のタスクの返し) と呼び返しの手間の分だけ遅くなってよいが、その量 (ミリ秒) を書き残す。
- 組版の結果が同じこと: (b)・(c)・(d) の領域の木と PDF のバイト列が (a) と同じこと (試験の 6 の 4)。

## 3. 止めたときの後始末

- **途中の結果は捨てる。** 止めたら、返す Promise を失敗にするだけで、途中の領域の木・ページ・PDF の文書 (pdf-lib の `PDFDocument`) は返さない
  (どこかに残さない。`LayoutEngine` は文書ごとに作るので、捨てれば消える)。
- **器の覚えを壊さない。** 止めるのは確かめる所 (2.1) だけで、どれも、覚えを書き換える処理の外 (前か後) に置く:
  - `SharedLineMemo` (段落の行分けの覚え): 覚えるのは、段落の行分けが終わってからの 1 回の書き込み。止める所 (`mkPage` など) はその外。
    止めた文書が覚えた段落は、中身で引く覚えなので、正しいまま残してよい (次に組む直した文書で当たる)。
    ただし「いまの文書と前の文書で使ったものだけを持つ」世代の数え方は、止めた文書で世代を進めない (止めた文書の分を「前の文書」にすると、
    その前に組み終えた文書の覚えが捨てられ、止めて組み直す使い方 (打つたびに前の組版を止める) で当たらなくなる)。
  - `FontPrepCache` (書体の下ごしらえ): 書き込みは同期の 1 回。止めるのは読む前か後。
  - 器の書体 (`loadOptional` の `optional`): 数式・等幅などの書体の読み込みは、同じ器のほかの呼び出しも待つ共有の Promise なので、
    止めた呼び出しの合図では**取得を止めない** (待つのをやめるだけ: `Promise.race` で、合図が来たら抜ける)。読み込みは続き、終われば次の呼び出しで使う。
    いまの「読めなかったら次の文書でまた試す」(`p.catch(() => optional.delete(key))`) はそのまま。
  - `base` の `FontManager` に足した書体・`baseWarnings` は、器を作り終えた後は書き換えないので、触らない。
  - 確かめ方: 6 の 3 (各ページで止めてから同じ器で組み直し、新しい器で組んだ結果とバイト列まで同じ)。
- **読みかけの取得を止める。** `fetchGuarded`・`fetchFont` に合図を渡す (2.1)。`resolveResource`・`loadFont` には `{ signal }` を渡す
  (利用者の関数が合図を見なければ、その読みは終わるまで続くが、結果は使わない)。
- **捨てた Promise の失敗を、拾わない失敗にしない。** `Promise.all` で並べて読む所 (CSS の読みなど) は、1 つが止まると、残りは後で失敗する。
  拾われない失敗 (Node の `unhandledRejection`) にならないよう、並べて読む所は `Promise.allSettled` で待ってから、止めた合図を投げる。
- 止めたかどうかに関わらず、器はそのまま次の `typeset` に使える (器を作り直さなくてよい)。`createTypesetter` を止めたときは、器はできない (Promise が失敗する)。

## 4. 呼び出しごとの文脈

### 4.1 中身

```ts
/** 1 回の呼び出し (typeset・toPdf など) の文脈 */
interface CallContext {
  readonly lang: MessageLang;          // 警告・誤りの文の言語
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: TypesetProgress) => void;
  readonly pace: boolean;               // signal か onProgress がある (間をあける)
  // 後の束で足すもの: limits (上限。5 の L2)・maxPages (先頭から N ページで止める)
}
```

- 作るのは `api.ts` の入口 1 か所 (`beginCall(options)`)。いまの `withMessageLang(options.lang, …)` を、`runInCall(ctx, …)` に置き換える。
  `lang` を省いた呼び出しは、いまの既定 (`setMessageLang` で決めたもの。コマンドの `--lang` など) を写して持つ。
- `toPdf`・`renderPageToSvg`・`renderPageToPng` は、いまと同じく組んだときの言語で書く: 組んだときの文脈から、`signal`・`onProgress` だけを
  その呼び出しの設定に替えた文脈を作る。

### 4.2 置き場所: Node は AsyncLocalStorage、無ければ引数で渡す

- `messages.ts` の `messageLang()` が、いまの文脈の言語を返す。`msg()` (566 か所。55 のファイル) は変えない。
- **AsyncLocalStorage がある環境** (Node。Deno・Bun も Node の互換で持つ): `globalThis.process?.getBuiltinModule?.('node:async_hooks')` で取る
  (Node 20.16・22.3 から。下限の 22.12 で使える)。`import` で書かないので、ブラウザ向けのビルド (`kumiori/browser`) は変わらず、束ねる道具も node の部品を探さない。
  `runInCall(ctx, fn)` は `als.run(ctx, fn)`。await をまたいでも文脈がついてくるので、深い所の `msg` も呼び出しごとの言語になる。
- **無い環境** (ブラウザ・Web Worker): 文脈を引数で渡し、同期の区間の初めで「いまの文脈」(モジュールの変数) に置く。
  - 同期の区間の途中では、ほかの呼び出しが割り込まない (JS は 1 本の流れ) ので、区間の初めに置けば、その区間の `msg` は正しい。
    割り込みが起きるのは await の後だけなので、**呼び出しの道筋の async の関数で、await の後に `msg` (や `msg` を呼ぶ同期の関数) を呼ぶ所**で、置き直す:
    `const v = await resume(ctx, p)` (`await p` の後に `current = ctx` を置く小さな関数)。
  - 文脈は、`typesetDocument` から下の async の関数に引数 (`ctx`) で渡す。同期の関数 (組版の本体など) には渡さない (区間の初めに置いた文脈を読む)。
  - 直す範囲の見積もり: await の後に msg を呼びうる async の関数は、`api.ts` (await 59)・`assets.ts` (32)・`pdfRenderer.ts` (36)・`fontManager.ts` (8)・
    `pdfLibPatches.ts` (9)・`colorGlyphPdf.ts`・`svgRenderer.ts`・`canvasRenderer.ts`・`pageRaster.ts`・`htmlPrepare.ts`・`eps.ts`・`pixels.ts`・
    `drawio/drawioStencil.ts`・`pdfaVerify.ts`・`pdfxVerify.ts` にある (合わせて await 200 ほど)。`epub.ts`・`nodeFonts.ts` はコマンドと Node だけ
    (AsyncLocalStorage がある)。`cli.ts`・`main.ts` (画面) は 1 つずつ呼ぶので直さない。直すのは、このうち呼び出しの道筋にある await で、150 ほどの見込み。
  - 取りこぼしの確かめ: 試験で AsyncLocalStorage を使わない作りに切り替え (内向きの切り替え `__setCallStoreForTest('module')`)、
    違う言語の呼び出しを同時に走らせて、言語ごとに 1 つずつ組んだときの警告と同じことを見る (6 の 2)。資源 (画像・`@font-face`・外の CSS・draw.io の図・
    読めない画像・PDF/A の確かめ) をひととおり含む文書で走らせ、await の後の置き直しの漏れを拾う。
  - 残る危うさ: 試験の文書で通らない道筋の漏れ。漏れても、混ざるのは文の言語だけ (組版の結果は変わらない) で、いまより悪くはならない。
- `setMessageLang` (コマンドが既定を決める) と `detectMessageLang` は残す。`withMessageLang` は内向きの関数 (`index.ts` から出していない) で、
  試験と画像の読み込みの試しで使うので、`runInCall` を包む形で残す。`api.ts` の入口は `runInCall(beginCall(options), …)` にする。
- `fontManager.ts` の、書体の知らせの覚えの鍵 (`messageLang()` を入れている) は、文脈の言語を読むので、そのままでよい。

### 4.3 今の作りからの移り方

1. `callContext.ts` を足し、`messages.ts` の `scopes` (進行中の切り替えの並び) を、文脈を読む作りに替える。`api.ts` の `withMessageLang` を `runInCall` に替える。
   この時点で、Node では混ざらなくなる (AsyncLocalStorage)。AsyncLocalStorage の無い環境の置き場所は、置き直し (`resumeCall`) をまだ呼ばないので、
   前と同じ動き (進行中のうち最後に始まった呼び出しの言語) を保つ (進行中の呼び出しの並びを持ち、いまの区間の文脈が無ければ最後のもの)。
2. ブラウザの道筋の置き直し (`resume`) を、ファイルごとに入れる。
3. `TypesetOptions.lang` の JSDoc と `docs/library.md` (日英) の「違う lang の呼び出しを同時に走らせると混ざる」という断りを消す。

## 5. 診断・誤りの型

- 止めたときは、`signal.reason` をそのまま投げる (WHATWG DOM §3.2 の `throwIfAborted`。理由を渡さずに `abort()` したときは
  `AbortError` の名前の `DOMException`)。`KumioriError` には包まない: `fetch` などほかの API と同じく `e.name === 'AbortError'` で見分けられるようにし、
  利用者が渡した理由 (`AbortSignal.timeout()` なら `TimeoutError` の `DOMException`) も、そのまま返す。`isKumioriError(e)` は false。
  - 診断の名前 (`code`) は足さない (警告ではなく、利用者が頼んだ止め。`ERROR_CODES` にも入れない)。
- `onProgress` が投げた誤りも、そのまま返す (包まない)。
- 選択肢の検査 (`checkOptions`): `signal` は `AbortSignal` の形 (`aborted` が真偽値で、`addEventListener` が関数。別の realm の合図も通すため
  `instanceof` では見ない)、`onProgress` は関数。誤りは、いまの選択肢の誤りと同じ `KumioriOptionError` (`api/invalid-option`)。`PdfOptions`・
  `RenderPageSvgOptions`・`RenderPagePngOptions` の検査にも同じものを足す。
- 文書に足すもの:
  - `docs/library.md`・`docs/en/library.md`: 「組み方の選択肢」に `signal`・`onProgress` の行、「組版を止める・進み具合」の節 (止める所と、
    1 つの page-sequence の中では外からの abort が効かないこと、`onProgress` で時間を見て止める例、器で前の組版を止めて組み直す例、Worker での使い方
    (親の「止める」は、間をあけた所で届く。すぐ止めたいときは `worker.terminate()`))。「投げる誤り」の表に「止めた」の行。
    `lang` の断りを消す。
  - `docs/diagnostics.md`・`docs/en/diagnostics.md`: 誤りの名前の一覧の後に、「止めたときの誤り」(`AbortError`・`signal.reason`。Kumiori の誤りの型ではない) の短い段落。
  - `CHANGELOG.md`・`CHANGELOG.en.md`: 足した選択肢と、言語の混ざりを直したこと。

## 6. 試験の案

`test/callControl.test.ts` (新しく足す):

1. **止める**
   - 止めた合図を渡すと、書体も文書も読まずに失敗する (`loadFont`・`resolveResource` が呼ばれない)。`typeset`・`typesetToPdf`・`createTypesetter`・器の `typeset`・`toPdf`・`renderPageToSvg`・`renderPageToPng` のそれぞれ。
   - `onProgress` の中で、`phase: 'layout'` の k ページ目で `abort()` すると、`AbortError` で失敗する (`DOMException`・`name`)。`abort(reason)` なら、その reason。
   - `resolveResource` が合図を受け取り、`abort()` で止まる (読みかけの取得を止める)。`fetch` を差し替えて、渡された合図が止まることを見る。
   - 止めた後に、拾われない失敗 (`unhandledRejection`) が出ない。
   - 外からの `abort()` (タイマー) が、回の境目・page-sequence の境目で効く (page-sequence の多い XSL-FO で、組み終える前に止まる)。
2. **言語が混ざらない**
   - 違う `lang` (ja・en) の呼び出しを、`Promise.all` で同時に 4 つずつ走らせ (警告の出る文書: 読めない画像・未対応の CSS・書体の知らせ・PDF/UA の足りないもの)、
     警告・誤りの文が、言語ごとに 1 つずつ組んだときと同じ。AsyncLocalStorage の作りと、使わない作り (4.2) の両方で。器の `typeset` と `toPdf` でも。
3. **器の覚えを壊さない**
   - 器で文書を組み、直した文書を k ページ目 (いくつかの k) で止め、同じ器で直した文書を組み直す。新しい器で組んだ結果と、警告・領域の木・PDF のバイト列が同じ
     (`test/reuse.test.ts` の比べ方を使う)。使い回しが当たったことも見る (止めた文書が世代を進めない)。
   - 数式の書体の読み込み中に止めても、同じ器の次の呼び出しで数式の書体を使える。
4. **渡さないときに前と同じ**
   - `signal`・`onProgress` を渡さない・止めない合図を渡す・何もしない `onProgress` を渡すの 3 つで、警告・領域の木・PDF のバイト列が同じ (HTML・XSL-FO・メモリ節約)。
   - 渡さないとき、組版の途中で間をあけない (`setImmediate`・`MessageChannel` を見張って、呼ばれないことを見る)。
5. **進み具合**
   - 段階の順 (`fonts` → `resources` → `import` → `layout` → `pdf`)、`layout` の `pages` がページ数まで 1 ずつ増え、回ごとに 1 から数え直すこと、
     `pdf` の `pages` が `total` まで増えること。段組・条件付きのマスター (`last`)・`force-page-count` の白ページで、`layout` の最後の回の `pages` が総ページ数と同じこと
     (後の「先頭から N ページ」の束の土台)。
   - `onProgress` が投げた誤りが、そのまま返る。
6. 選択肢の検査: `signal: {}`・`onProgress: 1` が `KumioriOptionError`。

## 7. 大きさの見積もりと、作る段の分け方

| コミット | 中身 | 大きさ (見込み) |
|---|---|---|
| 1 | 呼び出しごとの文脈 (`callContext.ts`)・`messages.ts` を文脈を読む作りに・`withMessageLang` を置き換え (Node で混ざらなくなる)・言語の試験 (6 の 2 の AsyncLocalStorage の側) | コード 150 行・試験 150 行 |
| 2 | ブラウザの道筋の置き直し (`resume`。15 ほどのファイルの await 150 ほど)・AsyncLocalStorage を使わない作りの試験 | コード 200〜300 行 (1 行ずつの直しが多い) |
| 3 | `signal`・`onProgress` の選択肢と検査・入口と資源の読み込みの確かめ・取得の合図 (`fetchGuarded`・`fetchFont`・`resolveResource`・`loadFont`)・器の後始末 | コード 250 行・試験 200 行 |
| 4 | 組版のページの確かめ (`LayoutControl`)・`layoutPasses`・`layoutOnce` のジェネレーター化と間・PDF・SVG・PNG の確かめと間・進み具合の試験・器の覚えの試験 | コード 250 行・試験 200 行 |
| 5 | 文書 (`docs/library.md`・`docs/diagnostics.md` の日英・CHANGELOG の日英)・速さの測り (2.3) の結果を、この覚え書きに足す | 文書 150 行 |

- 合わせて、コード 900〜1,000 行・試験 550 行・文書 150 行ほど。1〜2 (言語) と 3〜4 (止める・進み具合) は分けて main に入れられる。
- 組版の結果は変えない (試験の 6 の 4 と、見本の FO・CSS-Print の組み比べで、変わっていないことを確かめる)。

## 8. ぶつかる所 (同じ波の束)

### 8.1 上限を `options.limits` で変える束 (L2)

- **選択肢の名前**: この束は `signal`・`onProgress` (と `PdfOptions` などの同じ名前)、L2 は `limits`。名前はぶつからない。
  ただし、L2 が「組版全体の時間の上限」(例 `limits.timeMs`) を足すと、`signal: AbortSignal.timeout(ms)` と同じことを 2 つの書き方でできる。
  **推奨: 全体の時間の上限は L2 に足さず、`AbortSignal.timeout()` を案内する** (足すなら、中で `AbortSignal.timeout` を作って、この束の合図に合わせる)。
  `fetchTimeoutMs` (取得の時限) はいまのまま (取得ごとの時限で、全体の時間とは別)。
- **検査の置き場所**: どちらも `api.ts` の `checkOptions` に足すので、同じ所を直すとぶつかる。`checkOptions` の終わりに、それぞれ別の関数
  (`checkCallControl(o)`・`checkLimits(o)`) の呼び出しを 1 行ずつ足し、中身は別の所 (`callContext.ts` と L2 のモジュール) に置く。
  `TypesetterOptions` の形 (`Pick` に入れるか、`& { … }` で足すか) も、どちらも直すので、L2 の `limits` を器の設定と文書の設定のどちらで持つかを、先に決めて合わせる。
  `SETUP_ONLY_OPTIONS` にも、L2 が器の設定だけにするなら `limits` が入る。
- **呼び出しごとの文脈に上限を載せるか**: いまの上限は、モジュールの定数 (`imageLimits.ts` の `MAX_PIXELS` など、`tableLimits.ts`・`fetchLimits`) で、
  画像の読み (同期) など深い所で読む。呼び出しごとに変えるなら、言語と同じく「同時に走る呼び出しの間で混ざらない」作りが要るので、
  **推奨: 上限もこの束の `CallContext` に `limits` として載せ、深い所は `currentCall().limits` で読む** (言語と同じ置き場所・同じ置き直し)。
  そのため、L2 の作る段は、この束のコミット 1 (文脈) の後にする (先に L2 が別の作りを入れると、2 つの文脈ができる)。
  `CallContext` の形 (`limits` の欄の型) は、L2 の覚え書きで決めたものを、この束のコミット 1 で空の欄 (省略できる欄) として入れておくのでもよい。
- 上限を超えたときの誤り (`KumioriLimitError`) と、止めたときの誤り (`AbortError`) は別のもの。上限を「止めて誤りにする」ものに、この束の `check()` を使わない
  (上限は理由を診断の名前で持つ `KumioriLimitError` のまま)。

### 8.2 先頭から N ページで止める束 (L3)

- 同じ `LayoutControl.page()` (2.1) で数を見る。この束で、`page` を呼ぶ所 (置くページを作った所だけ) と、回ごとの数え方を決め、試験 (6 の 5) で守る。
- N ページで止めるのは「誤りにせず、そこまでの結果を返す」ので、`AbortError` とは別の、内向きの印 (`layoutOnce` で受けて、その回を終える) にする。
  `page()` が投げる/返すの形は、L3 で決める (この束では `void` を返し、止めるときは投げる)。
- 相互参照 (ページ番号の参照) の組み直しの回と、N ページで止めることの関わり (決まらない参照の警告) は L3 で扱う。この束の進み具合の `pass` を、そのまま使える。
- `maxPages` も `CallContext` に載せる (8.1 と同じ)。

## 9. 決めたこと (2026-11-22。取りまとめ役が利用者に聞いて、どれも推奨のとおり)

1. page-sequence の中では間をあけない (0 のとおり)。すぐ止めたいときは、`onProgress` の中で止めるか、Web Worker ごと止める (`worker.terminate()`) と、
   `docs/library.md` (日英) に書く。`Flow` をページの境目で止めて続けられる形への作り替えは、0.6.0 では作らない。
2. 止めたら `signal.reason` をそのまま投げる (理由を渡さなければ `AbortError` の `DOMException`。`KumioriError` に包まない)。
3. 結果の `toPdf`・`renderPageToSvg`・`renderPageToPng` は、それぞれの設定で止める合図を受ける。組んだときの合図は引き継がない (言語は引き継ぐ)。
4. コマンドには足さない。
5. ブラウザ (AsyncLocalStorage の無い環境) の言語の置き直しは、呼び出しの道筋の await を全部 (4.2)。
6. 上限 (上限を `options.limits` で変える束の `limits`) は、この束の `CallContext` に載せる。作る順は、`CallContext` を作るコミット 1 を先に main に入れ、
   上限の束はその上に作る。組版全体の時間の上限は、上限の束に入れない (`AbortSignal.timeout()` を案内する)。

## 10. 作った段

- コミット 1 (呼び出しごとの文脈の土台): `src/callContext.ts` (`CallContext`・`currentCall`・`runInCall`・`resumeCall`・試験用の置き場所の切り替え)。
  `CallContext` は、いまは `lang` だけを持ち、ほかの欄 (`signal`・`onProgress`・`pace`・`limits`・`maxPages`) は、省略できる欄として後で足す。
  `messages.ts` の `messageLang()` は文脈の言語 (呼び出しの外なら既定の言語)。`api.ts` の入口は `beginCall(options)` で文脈を作る
  (`lang` を省けば、始めたときの言語を写す)。結果の `toPdf`・`renderPageToSvg`・`renderPageToPng` と、`renderPage` (同期) も、組んだときの文脈で書く
  (`renderPage` は前は、そのときの既定の言語だった)。試験: `test/callContext.test.ts` (違う lang の `typeset`・器の `typeset` を同時に 4 つ走らせ、
  組版・PDF・SVG の警告が、言語ごとに 1 つずつ組んだときと同じ。入口の選択肢の誤りの文)、`test/messages.test.ts` (重なった呼び出しを、置き場所ごとに確かめる)。
  - 組版の結果: 対応仕様説明書 (XSL-FO・HTML。見本の展開をしない元の文書) を、変える前の main と、このコミットのビルドで、
    別々のプロセスで ja・en の両方で組み (PDF の日時と識別子は止めた値)、領域の木・PDF のバイト列・警告の SHA-256 が同じ。
    (2 つのビルドを 1 つのプロセスで読むと、HTML の開きタグの位置の仕掛け (`sourceLocation.ts` の `patchHtmlLocations`。印は `Symbol.for` で
    プロセスに 1 つ) を先に読んだビルドだけが入れるので、後のビルドの診断に行・列が付かない。比べ方の誤りで、このコミットとは関わらない)
  - 速さ (AsyncLocalStorage を使うようにした分。`scripts/profile-relayout.mjs --no-profile --no-reuse --runs 5`。2〜5 回目の中央値。ミリ秒。
    main と交互に 2 組): fo-spec の typeset は main 4,771・4,869、このコミット 4,752・5,178。toPdf は main 1,574・1,496、このコミット 1,470・1,753。
    html-spec の typeset は main 14,814・15,091、このコミット 14,758・15,083。toPdf は main 2,313・2,441、このコミット 2,190・2,414。
    どれも揺れ (±10%) の中で、決まった向きの差は見えない。
- コミット 2 (ブラウザの道筋の置き直し): 呼び出しの道筋の async の関数の await (27 のファイルの 230 か所) を、`rejoin(thisCall(), await …)` に書き換えた
  (TypeScript の構文の木で await の式を探して包む、使い捨ての書き換えの道具で。`(await x).y` の括弧は、`rejoin(…)` の括弧で置き換えた)。
  覚え書きの 4.2 の `resume(ctx, p)` の形をやめ、引数の評価の順 (左から) で await の前に文脈を取る形にした (関数ごとに文脈の変数を置かなくてよい)。
  `then` の呼び返しのうち、文言を書きうるもの (器の数式などの書体の読み込みの `registerBuffer`) は `bound` で包んだ。
  モジュールの変数の置き場所は、進行中の呼び出しの並びをやめ、いまの区間の文脈 1 つだけにした (呼び出し元の同期の区間には呼び出し元の文脈を戻し、
  呼び出しが終わったとき、いまの区間がその呼び出しのものなら呼び出しの外に戻す)。
  試験: `test/callContext.test.ts` を、AsyncLocalStorage とモジュールの変数の両方の置き場所で走らせる (文書に、外の CSS・`@font-face` の壊れた書体・
  中の画像の読めない SVG を足した。モジュールの変数の置き場所で `rejoin` を何もしない形にすると落ちることを確かめた)。
  上限 (`limits`) も同じ文脈に載るので、違う `limits` の呼び出し (`fileBytes` の違い) を同時に走らせて、それぞれの上限で組むことも、両方の置き場所で確かめる。
  `test/callContextAwait.test.ts`: 対象のファイルの await が、どれも `rejoin(thisCall(), await …)` の形であること (書き忘れを拾う)。
  対象の外: `cli.ts`・`main.ts`・`epub.ts`・`nodeFonts.ts`・`drawio/nodeFiles.ts` (コマンド・画面・Node だけ)・`index.ts`・`node.ts`・`linkedomModules*.ts` (読み込みだけ)・
  `messages.ts`・`callContext.ts`。
- コミット 3 (止める合図・進み具合の選択肢と、資源の読み込み): `CallContext` に `signal`・`onProgress` を足し、`callContext.ts` に
  `checkAbort`・`reportProgress`・`untilAbort` (分け合う Promise を止めずに、待つのをやめる)・`fetchSignal` (時限と呼び出しの合図を `AbortSignal.any` で合わせる) を足した。
  選択肢の検査は、上限と同じく `beginCall` の中 (`callControl`)。`beginCall` は、止めた合図を渡されたら、その場で理由を投げる。結果の `toPdf`・`renderPageToSvg`・
  `renderPageToPng` は `laterCall` で、組んだときの文脈から合図・進み具合だけを替える (止めた合図なら、その場で失敗する)。
  確かめる所: 既定の書体・`fonts` の書体ごと (`fonts`)、`resolveResource` の答えごと・FO の書体ごと・画像のファイルごと (`resources`)、`collectResources` の後・
  画像の取得の後・組み始める前 (取得の失敗として飲まれた合図を拾う)、読み込みの前 (`import`)。取得は `fetchGuarded` が `fetchSignal` を使う
  (既定の書体の `fetchFont` は、同じ実行のほかの呼び出しと分け合うので止めず、`untilAbort` で待つのをやめる。器の数式などの書体の読み込みも同じ)。
  `resolveResource`・`loadFont` には 2 つ目の引数で `{ signal }` を渡す (型 `ResourceContext`)。
  器の覚えの世代: 止めた文書は `FontPrepCache.cancelDocument`・`SharedLineMemo.cancelDocument` で世代を戻す (`typesetDocument` が、止める合図の理由で失敗したときだけ)。
  試験: `test/callControl.test.ts` (止めた合図・理由・読み込みの途中で止める・渡した合図・段階の順・`onProgress` の誤り・器の覚えの世代 (`cancelDocument` を
  何もしない形にすると落ちることを確かめた)・選択肢の検査)。
- コミット 4 (組版のページごとの確かめと進み具合、境目の間、PDF のページ): `LayoutControl` (`page`・`boundary`) を `LayoutEngine` の設定に足し、
  置くページを作る所 (`layoutSequence` の `mkPage`・`layoutColumnSequence` の `ensurePage`・`forcePageCount` の白ページ) で `notePage` から `page` を呼ぶ
  (メモリ節約の、決まった回を描くための組み直しでは呼ばない)。`layoutPasses`・`layoutOnce` を `passSteps`・`onceSteps` (ジェネレーター) にし、
  `forEach` を `for … of` に (前の回の page-sequence を使い回す所の `return` は `continue` に) した。同期で走らせる `layout`・`layoutSheets` と、
  境目ごとに `boundary` を待つ `layoutPaced`・`layoutSheetsPaced`。`callContext.ts` の `pause` は、合図を確かめ、前に間をあけてから 16ms 以上たっていれば
  1 度タスクを返す。PDF は、`renderPdfPages` がページを描く前に確かめ、描き終えるたびに進み具合を知らせる (`PdfPageSource.count` を足した)。
  `paint` は Promise を返してよく、間をあける呼び出しでは、ページの間で `pause` を待つ (メモリ節約の組版は、組み直しながら描くので間をあけない)。
  - 確かめ: `npm test` (340 ファイル・5,818 件)・`npm run e2e` (48 件)。対応仕様説明書 (XSL-FO・HTML) を ja・en で組んだ領域の木・PDF・警告の SHA-256 が、
    変える前の main と同じ。試験の中でも、`signal`・`onProgress` を渡しても渡さなくても同じ (`typeset` の領域の木と PDF・`typesetToPdf` のメモリ節約)。
  - 速さ (`scripts/profile-relayout.mjs --no-profile --no-reuse --runs 4`。2〜4 回目の中央値。ミリ秒。main と交互に 2 組):

    | 文書 | 段階 | main | 渡さない | `--signal` | `--progress` |
    |---|---|---|---|---|---|
    | fo-spec | typeset | 5,367・4,913 | 4,712・4,874 | 4,805・5,273 | 4,983・4,920 |
    | fo-spec | toPdf | 1,551・1,617 | 1,515・1,505 | 1,518・1,701 | 1,616・1,678 |
    | html-spec | typeset | 15,180・15,157 | 14,821・15,784 | 15,660・17,047 | 15,769・15,723 |
    | html-spec | toPdf | 2,337・2,363 | 2,347・2,417 | 2,507・2,608 | 2,349・2,316 |

    渡さないときは main と揺れの中。渡したときは、html-spec の typeset で 3〜12% ほど遅い組がある (間をあけるのは、回・page-sequence の境目と
    資源の読み込みだけで、数十回。進み具合の呼び返しは 300 回ほど)。揺れ (±10%) との区別は、この 2 組ではつかない。
- コミット 5 (説明書): `docs/library.md`・`docs/en/library.md` に、選択肢の表の `signal`・`onProgress`、新しい節「組版を止める・進み具合 (signal・onProgress)」
  (前の組版を止めて組み直す例・止めたときの誤り・確かめる所と間をあける所・page-sequence の中では外からの abort が効かないことと、`onProgress` の中で止める例・
  器の覚え・結果の `toPdf` などの合図・`TypesetProgress` の段階の表)、`resolveResource` の 2 つ目の引数、「投げる誤り」の表の「止めた」の行、
  Web Worker の中での止め方 (`abort()` は間をあけた所で届く。すぐ止めるなら `worker.terminate()`。進み具合は `postMessage` で親に送れる) を足した。
  `docs/diagnostics.md`・`docs/en/diagnostics.md` の「誤りの型と名前」に、止めたときの誤り (`signal.reason`。Kumiori の誤りの型ではない) を足した。
  CHANGELOG (日英) に、組版・PDF の段階と、間をあける所を足した。`npm run docs:api` は警告なし。

## 11. 残ったこと

- 1 つの page-sequence の組版の途中で間をあけること (9 の 1。`Flow` をページの境目で止めて続けられる形にする作り替え。`design/relayout.md` の段階 4 と同じ土台)。
- 読み込み・カスケード (`importHtmlText` の中。同期) の途中の確かめ (いまは前後だけ。151 ページの HTML で 4〜5 秒)。要るなら、要素の数ごとに `checkAbort` を置く
  (同期の途中なので、外からの abort は効かず、効くのは onProgress の中で止めたときだけ。読み込みの段階には、まだページごとのような呼び返しが無い)。
- 画像の形式のプラグイン (`ImageFormatContext`) と draw.io の図形ライブラリの取得には、まだ合図を渡していない (取得そのものは `fetchGuarded` を通るものは止まる)。
