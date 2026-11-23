# JS が組み上げたページを文字にして組む (snapshotDocument) の設計の覚え書き

状態: 作った (2026-11-22。作る段の 5 回のコミットで main に入れた)。9 の決めは、利用者が 1〜9 をどれも推奨の案に決めた。

作る段で、この覚え書きと変えたこと・分かったこと:

- フォームの部品: Kumiori は input の value の字を描かない (textarea の中身・select の option の字 (全部)・button の字・canvas の代わりの中身は描く)。決め 5 のとおり属性に書き戻すだけにし、描くことは台帳の別の項目にした。
- ::part() は扱わない (外の文書の CSS の元の字を書き換えないと当てられない)。canvas を名指しした規則は、セレクタの並びに img[data-kumiori-canvas] の形を足す (元の canvas の形も残す)。
- 選択肢の誤りの名前は api/invalid-option (KumioriOptionError の code)。canvas-too-large の args は element・size (画素の数かバイト)・limit にそろえた。
- インラインの svg の中の image の http(s) の画像は、組版の側が取りに行かない (resolveResource には聞くが、fetchImages に聞かずに取らない)。snapshot の外の誤りとして、台帳の別の項目にした。
この覚え書きは、リリースする文書 (`docs/` など) ではありません。

利用者の決め (2026-11-22。9 の 1〜9。どれも推奨の案):

1. 出す入口: `src/index.ts` から出す (`kumiori` と `kumiori/browser` の両方)。DOM の無い所では誤り。
2. 返す形: `{ html, options: { kind, name, files }, baseUrl, diagnostics, warnings }`。書体は `files` と書き足す `@font-face` で渡す (`fonts` は返さない)。
3. 基準の URL: snapshot の側で、文書の中の URL を全部絶対にする (`typeset` は変えない)。
4. Shadow DOM のスタイル: 平らな木に展開し、影の木のセレクタを属性で囲うように書き換える (詳しさの違いは近似として説明書に書く)。
5. フォームの部品: 属性に書き戻すだけ。作る段の初めに Kumiori が部品の中の値の字を描くかを確かめ、描かなければ、描くことを別の項目にする。
6. 待ち切れないとき: その時の DOM で文字にし、`snapshot/wait-timeout` の警告を出す (既定 10 秒)。
7. JS で足した書体: `fontSources` の呼び返しだけ。`FontFace` を包む関数は、次の段の `--render-js` で考える。
8. 取り込む合計の上限: snapshot だけの `snapshotBytes`、既定 512MB (上げ下げできる)。
9. 試験: Chart.js・styled-components を開発の依存に足さず、同じ形のページを手で作って試す。実物は作る段で 1 度、手元で確かめる。

ねらい: Kumiori は JS を動かさない。けれども、ブラウザで JS が組み上げた後の DOM を文字にして `typeset` に渡せば、多くのページを組める。
`'<!doctype html>' + document.documentElement.outerHTML` だけでは落ちるもの (canvas の絵・CSSOM に直に入れたスタイル・Shadow DOM・
フォームのいまの値・blob: の URL・JS で読んだ書体・相対の URL の基準) を拾い、文字にする時を待つ仕組みと合わせて、
1 つの関数 `snapshotDocument(document, options)` にする。返したものは、そのまま `typeset` に渡せる形にする。

前提にしたもの (2026-11-22 の main、d98a199):

- `typeset(html, options)` は HTML の文字列を受ける (`src/api.ts`)。`TypesetOptions` の知らない名前は `TypeError` で拒む (`checkOptions`)。
- 文書の基準の URL を渡す選択肢は無い。文書の中の相対の参照は、`files` の名前 (文書からの相対のパス) か `resolveResource` で引く。
  http(s) の絶対の URL は、`fetchImages`・`fetchStyles` (既定 true) の決まりで取る (`src/documentResources.ts`・`src/resources.ts`)。
  `<base href>` は読んでいない (`src/` に `base` の要素を扱う所が無い)。
- `<script>` は組む前に取り除く (`src/htmlPrepare.ts` の `parsed.querySelectorAll('script')…remove()`)。
- ブラウザの画面では HTML を `DOMParser` で読む。`DOMParser` で読んだ文書は、仕様のうえで「scripting が無効」の文書なので
  (HTML §8.5.1 DOMParser の parseFromString)、`<noscript>` の中身が組まれ、`<template shadowrootmode>` (宣言の Shadow DOM) は展開されない。
- `kumiori/browser` は `src/index.ts` を 1 ファイルにまとめたもの (`vite.browser.config.ts`)。型は `kumiori` と同じ `dist-lib/types/index.d.ts`。
- 入力の上限 (`options.limits`。`design/limits.md`): `imagePixels` (1 枚の画像の画素。既定 1 億) と `fileBytes` (渡したファイル 1 つ。既定 256MB)。
- 呼び出しごとの文脈 (`src/callContext.ts`): `src` の async の関数の await は `rejoin(thisCall(), await …)` の形にする (`test/callContextAwait.test.ts`)。
- フォームの部品 (`input`・`select`・`textarea`・`button`) は、既定のスタイルの箱として組む (`src/cssCascade.ts` の UA のスタイル)。
  部品の中の値の字を描くかは、この覚え書きでは確かめきれなかった (作る段の初めに確かめる。4.4)。

---

## 1. API の形

### 1.1 名前と型

```ts
export function snapshotDocument(doc?: Document, options?: SnapshotOptions): Promise<DocumentSnapshot>;

export interface SnapshotOptions {
  /** ページの側の「準備できた」の合図。Promise ならそれを待つ。関数なら、真の値を返すまで (Promise ならその解決まで) アニメーションのフレームごとに呼ぶ */
  waitFor?: Promise<unknown> | (() => unknown);
  /** 待つ時間の上限 (ミリ秒。既定 10,000)。過ぎたら、その時の DOM で文字にして、snapshot/wait-timeout の警告を出す */
  timeoutMs?: number;
  /** 止める合図 (TypesetOptions.signal と同じ扱い。止めたら AbortError の DOMException を投げる) */
  signal?: AbortSignal;
  /** 中身に入れる Shadow DOM の根 (閉じた根を含む。HTML の getHTML() の shadowRoots と同じ考え)。開いた根は渡さなくても入れる */
  shadowRoots?: ShadowRoot[];
  /** CSS の @font-face に繋がらない書体 (new FontFace で作って document.fonts に足したもの) の中身を返す関数 (3.6) */
  fontSources?: (face: FontFace) => KumioriFileData | undefined | Promise<KumioriFileData | undefined>;
  /** canvas の扱い。'png' (既定): 絵を PNG にして img に置き換える。'skip': 置き換えない (canvas は空の箱として組む) */
  canvas?: 'png' | 'skip';
  /** 上限 (imagePixels・fileBytes は TypesetOptions.limits と同じ名前と既定。snapshotBytes は取り込む合計。4.1) */
  limits?: Pick<KumioriLimits, 'imagePixels' | 'fileBytes'> & { snapshotBytes?: number };
  /** 警告の文の言語 (TypesetOptions.lang と同じ) */
  lang?: MessageLang;
}

export interface DocumentSnapshot {
  /** 文字にした文書 (<!doctype html> から) */
  html: string;
  /** typeset の選択肢にそのまま渡すもの: kind・name・files (取り込んだ canvas の PNG・blob: の中身・書体)。files の data はどれも Uint8Array */
  options: { kind: 'html'; name: string; files: KumioriFile[] };
  /** 文字にしたときの文書の基準の URL (document.baseURI)。情報として返す (html の中の URL は、もう絶対の URL にしてある) */
  baseUrl: string;
  /** 取れなかったもの・近似したもの (snapshot/… の診断。3.9) */
  diagnostics: Diagnostic[];
  /** diagnostics の文 (TypesetResult.warnings と同じ形) */
  warnings: string[];
}
```

使い方:

```ts
const snap = await snapshotDocument(document, { waitFor: () => window.chartsReady });
const r = await typeset(snap.html, { ...snap.options, pageSize: 'A4' });
```

- `doc` を省けば `globalThis.document`。
- 選択肢は `typeset` と同じく、知らない名前・型の違う値を `TypeError` で拒む。
- 返すものは、ふつうのデータ (文字列と `Uint8Array`) だけにする。`structuredClone` でき、`postMessage` で Web Worker に送れる
  (`files` の `data` を、使うときに読む関数にしない)。

### 1.2 返す形を typeset に渡せるか

台帳の案は `{ html, files, fonts, baseUrl }` だった。次の 2 つの理由で、形を変える (9 の決め 2)。

- `typeset` は知らない名前を拒むので、返したものを丸ごと `typeset(html, { ...snap })` とは渡せない (`html`・`baseUrl` で拒まれる)。
  `typeset` に渡すものだけを `options` にまとめ、`{ ...snap.options, ほかの選択肢 }` と書けるようにする。
- `fonts` (足す書体) は、書体のファイルの中のファミリー名で使う。JS の `new FontFace('別名', …)` の名前は、ファイルの中の名前と違ってよいので、
  `fonts` に入れると、文書の `font-family: 別名` に当たらない。書体は `files` に入れ、`@font-face` の規則を文書に書き足して、FontFace と同じ名前・太さ・傾き・
  `unicode-range` で使う (3.6)。よって `fonts` は返さない。

基準の URL は、`typeset` に選択肢を足さずに、snapshot の側で文書の中の URL をすべて絶対の URL に書き換える (3.7。9 の決め 3)。
`baseUrl` は情報として返すだけ。

### 1.3 受ける入口と、DOM の無い所

- `src/snapshot.ts` に置き、`src/index.ts` から出す (9 の決め 1)。`kumiori` も `kumiori/browser` も、同じ `src/index.ts` から作るので、両方から使える。
  型も `dist-lib/types/index.d.ts` に入る。
- 使えるのは、ブラウザの画面 (DOM と画面の描画のある所) だけ。
  - Web Worker の中には `document` が無い。`doc` を省いて `globalThis.document` も無ければ、`KumioriOptionError` (コード `option/invalid`) で、
    「DOM のある所 (ブラウザの画面) で呼ぶ。Web Worker では、画面で snapshotDocument を呼び、結果を postMessage で送る」と出す。
  - Node で linkedom の文書を渡しても、canvas・CSSOM の `cssRules`・Shadow DOM・`document.fonts` が無いか違うので、使えるとはしない。
    `doc.defaultView` が無い (画面の無い) 文書は、上と同じ誤りで拒む。
- Web Worker で組むときの流れ (説明書に書く): 画面で `snapshotDocument` → `postMessage(snap, snap.options.files.map((f) => f.data.buffer))` →
  Worker で `typeset(snap.html, snap.options)`。
- `src/snapshot.ts` は、組版の本体 (`htmlImport.ts` など) を読まない、小さなモジュールにする。`kumiori` の利用者のバンドルに入っても、
  使わなければ木の揺すり (tree-shaking) で落ちる。次の段の Node のコマンドの `--render-js` (Playwright で開いて、同じ関数をページの中で動かす) で、
  この関数だけを 1 つのスクリプトにまとめてページに入れられるようにするため (3.10)。

### 1.4 待つ仕組み

文字にする前に、次の順で待つ。どれも `timeoutMs` の中で待ち、過ぎたらその時の DOM で文字にする。

1. 文書の読み込み: `document.readyState` が `complete` になるまで (`load` のイベント。HTML §8.4 の文書の読み込みの終わり、`readyState` は §3.1.3)。
2. 書体: `document.fonts.ready` (CSS Font Loading 3 §3.4 の `ready`。読み込み中の書体が無くなったら解決する)。
3. ページの側の合図 `waitFor`:
   - Promise なら、それを待つ。
   - 関数なら、`requestAnimationFrame` のたびに呼び、真の値 (か、真の値で解決した Promise) を返したら終わり。
     例: `() => window.chartsReady`・`() => document.querySelector('.loading') === null`。
4. 描画の落ち着き: `requestAnimationFrame` を 2 回待つ (最後の DOM の変更が、canvas の描画と書体の当て直しまで済むように)。
   - `document.getAnimations()` (Web Animations 1 §5.3 の `getAnimations`) のうち、終わりのあるものが走っていれば、その `finished` も待つ。
- 画像の読み込みは待たない。`<img>` の URL は絶対の URL にして Kumiori が自分で取るので、画面の上で読み終わっている必要が無い
  (`loading="lazy"` で画面の外にあり、まだ読まれていない画像も、そのまま組める)。
  例外は blob: の URL の画像で、読み終わった後に `URL.revokeObjectURL` で消す書き方が多いので、読み終わった画像から取る (3.5)。
- 待つ時間が過ぎたら、`snapshot/wait-timeout` の警告を出して続ける (誤りにしない。9 の決め 6)。止める合図 (`signal`) は、待つ間も確かめる。
- Chart.js などの、`requestAnimationFrame` で自分で動かすアニメーションは、Web Animations ではないので 4 では待てない。
  ページの側で、アニメーションを切るか、終わりの呼び返しで合図を立てて `waitFor` で待つ (説明書に書く)。

---

## 2. 文字にする手順

元の文書は変えない。`doc.documentElement` を `cloneNode(true)` で写して、写しを直してから文字にする。
ただし、写すと落ちるもの (canvas の絵・フォームのいまの値・Shadow DOM・img の読み込みの状態) は、元の要素から読む。
そのために、元の木と写しの木を、同じ順でたどって組にする (`TreeWalker` で並べてたどる。写しは元と同じ形)。

1. 待つ (1.4)。
2. 写しを作り、元と写しの要素を組にする。
3. Shadow DOM を写しに展開する (3.3)。展開した要素も、元の (影の木の中の) 要素と組にする。
4. 要素ごとに直す: canvas (3.1)・フォームの値 (3.4)・blob: の URL (3.5)・URL を絶対にする (3.7)・`srcset` を `currentSrc` に (3.7)・script と動かす所を取り除く (4.3)。
5. スタイル: CSSOM の規則を書き出す (3.2)。JS の書体の `@font-face` を書き足す (3.6)。
6. `'<!doctype html>\n' + 写し.outerHTML` で文字にする。

`outerHTML` は HTML の断片の文字にする手順 (HTML §13.3 Serializing HTML fragments) を使う。属性に書いてある値と、子の中身が残り、
IDL の属性だけにある状態 (フォームの値・canvas の絵) と、影の木と、CSSOM の規則は残らない。以下は、その落ちるものごとの取り方。

---

## 3. 落ちるものごとの取り方

### 3.1 canvas の絵

- 取り方: 元の `<canvas>` の `toBlob(…, 'image/png')` (HTML §4.12.5.1 の serialising bitmaps to a file。`toDataURL` も同じ手順) で PNG にし、
  `files` に `kumiori-snapshot/canvas-1.png` などの名前で入れ、写しの `<canvas>` を `<img src="kumiori-snapshot/canvas-1.png">` に置き換える。
  - 置き換えた `img` には、`id`・`class`・`style`・`width`・`height`・`role`・`aria-*`・`title` を写し、`alt` は canvas の中身 (代わりの中身の字) を写す。
    CSS の大きさの指定は `style` と、`canvas` を名指しした規則で当たる。`canvas` を名指しした規則 (`canvas { width: 100% }` など) は、`img` に当たらなくなるので、
    写しの `img` に `data-kumiori-canvas` の属性を付け、3.2 で書き出す CSS の規則の型 (要素の名前の `canvas`) を `img[data-kumiori-canvas]` に書き換える
    (セレクタの書き換えは 3.3 と同じ道具)。
  - canvas の本来の大きさ (`width`・`height` の属性) は PNG の画素の大きさと同じなので、CSS で大きさを決めていない canvas も同じ大きさになる。
    Chart.js は、画面の `devicePixelRatio` 倍の画素で描き、`style` に CSS の大きさを書くので、高い解像度の PNG で、同じ大きさに置かれる。
- `toBlob` は非同期で、大きな canvas でも画面を止めない (`toDataURL` は同期で、base64 の文字列で 1.33 倍になるので使わない)。
- 取れないもの:
  - 別の origin の画像を描いて汚れた canvas (origin-clean が偽): `toBlob` が `SecurityError` を投げる (HTML §4.12.5.1)。
    → 置き換えずに canvas のまま残し、`snapshot/canvas-tainted` の警告。
  - WebGL の canvas で `preserveDrawingBuffer: false` (既定) のもの: 描いた後のフレームでは、中身が消えていて、空の画像になることがある。
    → 取れたものを使う (空かは見分けられない)。説明書に「WebGL は `preserveDrawingBuffer: true` で作る」と書く。
  - 大きすぎる canvas (4.1): `snapshot/canvas-too-large` の警告で置き換えない。
  - 幅か高さが 0 の canvas: 置き換えない (警告も出さない。画面にも何も無い)。
- `canvas: 'skip'` なら置き換えない。
- `<video>` は、この段では扱わない (`poster` の URL を絶対にするだけ)。いまの画の取り込みは、要る声があれば足す (同じ origin なら canvas に描いて取れる)。

### 3.2 CSSOM に直に入れたスタイル

styled-components・emotion の本番の作り (`insertRule` で規則を足し、`<style>` の中身の字は空のまま)、`adoptedStyleSheets` (作ったスタイルシート)、
JS で `sheet.cssRules` を書き換えたもの。

- 仕様: CSSOM §6.1 `CSSStyleSheet` (`cssRules`・`insertRule`・作ったスタイルシートの `replaceSync`)、§6.2 の文書のスタイルシートの並び (`document.styleSheets`)、
  §6.1 の origin-clean の旗 (別の origin のスタイルシートの `cssRules` を読むと `SecurityError`)、
  `adoptedStyleSheets` (CSSOM §6.? `DocumentOrShadowRoot` の拡張。文書の CSS のスタイルシートの並びの後ろに続く)、
  規則の文字にする手順 (CSSOM §6.4 の serialize a CSS rule。`cssText`)。節の番号は作る段で原文と照らす (CSSOM は Editor's Draft で、番号が動く)。
- **規則を全部書き出さない**: ブラウザは知らないプロパティ・規則を、読んだときに捨てる (CSS Syntax 3 §9・CSS 2.2 §4.2 の、知らないものを無視する決まり)。
  `cssRules` から書き出すと、印刷の CSS で大事な、ブラウザが知らない指定 (`string-set`・`bookmark-label`・`float: footnote`・`-ah-*`・
  `@page` の余白の箱の一部・`target-counter()` の `content` など) が消える。そこで、元の字があるスタイルシートは元の字を残し、CSSOM で足された分だけを書き足す。
- 手順 (スタイルシートごと):
  - `<style>` の要素: 元の字 (`textContent`) を、新しく作ったスタイルシート (`new CSSStyleSheet()` の `replaceSync`) で読み、規則の `cssText` の並びを、
    いまの `sheet.cssRules` の `cssText` の並びと比べる。
    - 同じなら、そのまま (写しの `<style>` の字を使う)。
    - 違えば、元の字を残し、いまの並びにあって元の字の並びに無い規則を、後ろに書き足す (`/* kumiori-snapshot: CSSOM */` の印を付けた `<style>` を、
      その `<style>` の直後に置く)。いまの並びから消された規則 (元の字にあって、いまの並びに無いもの) は、元の字から消せない
      (どの字の範囲が、どの規則かを、ブラウザは返さない) ので、残して `snapshot/stylesheet-rule-removed` の警告を出す。
      styled-components の本番は、元の字が空なので、全部の規則を書き足すことになる。
    - 入れ子の規則 (`@media`・`@supports`・`@layer`・CSS の入れ子) は、外の規則の `cssText` で比べる (中の規則が足されれば、外の規則ごと違うものとして書き足し、
      元の外の規則は残る。同じ規則が 2 度当たるが、後の方 (いまの中身) が勝つので、結果は同じになる)。
  - `<link rel="stylesheet">`: 写しの `href` を絶対の URL にして残す (Kumiori が `fetchStyles` で自分で取り、元の字で読む)。
    `cssRules` を読めれば (同じ origin か、CORS で読んだもの)、元の字を `fetch` で取り直さずに比べられないので、比べない
    (`<link>` の規則を JS で書き換えるページは少ない。書き換えていても、元の字のまま組む。説明書に書く)。
  - `@import` で読んだスタイルシートも、`<link>` と同じ (`@import` の URL を絶対にして、Kumiori が取る)。
  - 作ったスタイルシート (`document.adoptedStyleSheets`): 元の字が無いので、`cssRules` の `cssText` をつないで書き出し、`<style data-kumiori-adopted>` にして
    文書のスタイルシートの最後 (`<head>` の終わり。本文に `<style>`・`<link>` があれば、その最後の後ろ) に置く。並びの順は CSSOM のとおり、文書のスタイルシートの後ろ。
    ブラウザの知らない指定は消えている (作ったスタイルシートに書いた時に捨てられている) ので、取り戻せない。説明書に書く。
  - 無効にしたスタイルシート (`sheet.disabled`): 写しの `<style>`・`<link>` を取り除く (HTML §4.2.6 の `disabled`)。`media` の属性は、そのまま残す
    (Kumiori が自分で `print` で照らす)。
- 書き出した規則の中の `url(…)` は、その規則のスタイルシートの基準 (`sheet.href`、無ければ文書の基準) で絶対の URL にする (3.7)。
- 取れないもの:
  - 別の origin のスタイルシートで CORS の無いもの: `cssRules` が `SecurityError`。→ `<link>` は残るので、Kumiori が取れれば組める
    (取れるかは Kumiori の `fetch` の CORS で決まる。4.2)。JS で足した規則は取れない。警告は出さない (`<link>` の中身は Kumiori が取るので、落ちたものを見分けられない)。
    別の origin の作ったスタイルシートは無い (作ったスタイルシートは、いつも作った文書の origin)。
- 要素の `style` の属性は、JS で `el.style.color = …` と書いても属性に写るので、そのまま残る (CSSOM §6.7 の CSS declaration block の属性との同期)。
  `CSS.registerProperty` (CSS Properties and Values API) の登録は、文字にできないので扱わない。

### 3.3 Shadow DOM (Web Components)

- 仕様: DOM §4.2.2 Shadow trees (`attachShadow`・`mode` の open と closed・`Element.shadowRoot` は閉じた根で null)、§4.2.2.4 の slot への割り当て
  (`assignedNodes({ flatten: true })`)、CSS Scoping 1 §2 の平らな木 (flat tree) と §3 の影の木の中のスタイル (`:host`・`::slotted()`・`::part()`)、
  HTML §8.5 の `getHTML({ serializableShadowRoots, shadowRoots })` (影の木を `<template shadowrootmode>` で書く)。
- `getHTML()` の書き方は使わない: Kumiori は `DOMParser` で読むので、`<template shadowrootmode>` を影の木に展開しない (前提のとおり)。
  Kumiori に宣言の Shadow DOM を読ませるのは別の仕事 (HTML の組版の本体の変更) で、この関数の外。
- そこで、**平らな木に展開する**: 影の根を持つ要素 (host) ごとに、
  - 写しの host の子を、影の根の子の写しに置き換える。影の木の中の `<slot>` は、割り当てられた節 (`assignedNodes({ flatten: true })`。
    無ければ slot の代わりの中身) の写しに置き換える (slot は既定で `display: contents` なので、slot の箱は無くてよい。HTML §15.3.1 の既定のスタイル)。
    名前の付いた slot にも、名前の無い slot にも割り当てられなかった host の子は、画面にも出ないので、捨てる。
  - 入れ子の影の木 (影の木の中の host) も、同じように中から展開する。
  - 影の根のスタイル (影の根の中の `<style>`・`<link rel="stylesheet">`・影の根の `adoptedStyleSheets`) は、その影の木の中だけに当たるので、セレクタを書き換えて文書に置く:
    - 影の木 N の中の要素に `data-ks-s="N"`、host に `data-ks-h="N"`、slot に割り当てられた (host の子の) 要素に `data-ks-sl="N"` の属性を付ける。
    - 影の木 N の規則のセレクタの、複合セレクタごとに `[data-ks-s="N"]` を足す (影の木の外の要素に当たらないように)。
      `:host` → `[data-ks-h="N"]`、`:host(X)` → `[data-ks-h="N"]X`、`:host-context(X)` → `X [data-ks-h="N"], X[data-ks-h="N"]`、
      `::slotted(X)` → `X[data-ks-sl="N"]` に書き換える。`::part()` は、外の文書の規則の `host::part(p)` を `[data-ks-h="N"] [part~="p"][data-ks-s="N"]` にする。
    - 書き換えは、CSS Syntax 3 §4 の字句の分け方で、外側の (括弧の中でない) `,` と結合子で区切って行う。`src/cssSelector.ts` の読み方は
      DOM に当てるためのもので、文字に戻す手段が無いので、小さな書き換えを `src/snapshot.ts` に置く。
  - 違い (近似): 属性のセレクタを足すので、詳しさ (specificity) が (0,1,0) 上がる。カスケードの、影の木と外の文書の間の順 (CSS Cascade 5 §6.? の shadow tree の文脈。
    外の文書の規則が、`!important` でない限り `:host` の規則に勝つ) は、書き換えた規則を文書の規則の前に置くことで近づける
    (詳しさが上がった分、外の規則に負けない所が出る。説明書に「近似」と書く)。
  - 別の案 (9 の決め 4): 影の木の中の要素の `getComputedStyle` を `style` の属性に書く。セレクタの書き換えが要らず、見た目の再現は確かだが、
    計算した値は画面の幅で解いた長さ (`width: 50%` が `width: 600px`) になり、紙の幅で組み直せない。`::before`・`::after` も落ちる。推奨しない。
- 閉じた影の根: `Element.shadowRoot` が null なので見えない。`shadowRoots` の選択肢で渡されたものだけ入れる (`getHTML` の `shadowRoots` と同じ考え)。
  - 見分け: カスタム要素 (`customElements.get(要素の名前)` があり、名前に `-` がある) で、`shadowRoot` が null、光の木の子が無いのに画面に箱がある
    (`getBoundingClientRect` の大きさが 0 でない) ものを「閉じた影の根がありそう」とし、`snapshot/shadow-root-closed` の警告を出す
    (確かめる API は無いので、推し量り。光の子がある要素は見分けない)。
- `<template>` (影の根でないもの) は、中身が組まれない要素としてそのまま残す。

### 3.4 フォームのいまの値

- 仕様: HTML §4.10.5.4 (input の値の扱い。`value` の IDL の属性と、内容の属性 `value` の違い (dirty value flag)、`checked` と dirty checkedness)、
  §4.10.10 (option の `selected` と selectedness)、§4.10.11 (textarea の raw value)。利用者が入れた値は IDL の属性にだけあり、文字にすると落ちる。
- 取り方 (元の要素の IDL の属性から、写しの内容の属性へ):
  - `input` (text・number・date など、値を持つ種類): `value` の属性に、いまの `value` を書く。
  - `input` の checkbox・radio: `checked` の属性を、いまの `checked` に合わせて付け外す。
  - `select`: 各 `option` の `selected` の属性を、いまの `selected` に合わせる。
  - `textarea`: 写しの子の字を、いまの `value` にする。
  - `details`・`dialog` の `open` は属性なので、そのまま残る。
- **書かないもの**: `input type="password"` の値 (紙に出さない。画面でも見えない)。`type="file"` (値は名前だけで、中身ではない)。`type="hidden"` (画面に出ない。値も写さない)。
- Kumiori の側で部品の中の値の字を描かなければ、属性に書いても紙に出ない (前提のとおり、作る段の初めに確かめる)。描かないなら、次のどちらか (9 の決め 5):
  - (推奨) 属性に書くだけにする (文書として正しい写しにする)。部品の中の字を描くのは、Kumiori の HTML の組版の変更として別の項目にする。
  - 選択肢 `forms: 'text'` で、部品をいまの値の字の `<span>` に置き換える (印刷の見た目に寄せる。部品の枠は消える)。

### 3.5 blob: の URL

- 仕様: File API §8 (blob の URL。§8.3 の解決: 作った文書の origin の中でだけ、生きている間だけ読める。`URL.revokeObjectURL` で消える)。
- 取り方: 属性 (`src`・`href`・`poster`・SVG の `href`・`xlink:href`) と、CSS の `url()` (3.2 で書き出す規則と `style` の属性) の blob: の URL を集め、
  `fetch(blobUrl)` で中身を読んで `files` に `kumiori-snapshot/blob-1.png` などで入れ、参照を書き換える。
  - 拡張子は、blob の `type` (MIME の型) から付ける (`image/png` → `.png`、`image/svg+xml` → `.svg`、`text/css` → `.css`、`font/woff2` → `.woff2`。分からなければ拡張子無し。
    Kumiori は画像を先頭のバイト列でも見分ける)。
  - 同じ blob: の URL は 1 つのファイルにする。
- 消された blob: の URL (`revokeObjectURL` の後): `fetch` が失敗する。`<img>` で、読み終わっている (`complete` で `naturalWidth` が 0 でない) ものは、
  画像を canvas に描いて PNG にする (blob: は同じ origin なので canvas は汚れない)。SVG の画像は、描くと図形でなく画素になる (消された blob の型は分からないので、警告にはせず、説明書に書く)。
  それ以外 (CSS の背景・読み終わっていない画像) は、`snapshot/blob-unreadable` の警告で、URL のまま残す (組むと読めない画像になる)。
- `data:` の URL は、そのまま残す (Kumiori が読む)。

### 3.6 JS で読んだ書体 (FontFace)

- 仕様: CSS Font Loading 3 §2 (`FontFace`。`family`・`style`・`weight`・`stretch`・`unicodeRange`・`featureSettings`・`variationSettings`・`status`)、
  §3 (`FontFaceSet` = `document.fonts`。CSS の `@font-face` に繋がった書体 (CSS-connected) と、`add()` で足した書体)。
  **FontFace は、書体のファイルの中身も、URL も返さない** (どの属性にも無い)。よって、snapshot の側だけでは中身を取れない。
- CSS の `@font-face` から来た書体: 規則は 3.2 で CSS として残り、`src` の URL は絶対にしてあるので、Kumiori が `fetchStyles` で取る。
  書体の取り込みは CSS Fonts 4 §4.9 のとおり CORS で行われているので、画面で読めた別の origin の書体は、Kumiori の `fetch` でも読める見込みが高い。
- JS で作って `document.fonts.add()` した書体 (CSS に繋がらないもの。`document.fonts` の中で、どの `@font-face` の規則にも当たらないもの):
  - `fontSources(face)` を渡されていれば、それが返した中身を `files` に `kumiori-snapshot/font-1.<形式>` で入れ、
    `@font-face { font-family: <face.family>; src: url(kumiori-snapshot/font-1.woff2); font-weight: <face.weight>; font-style: <face.style>;
    font-stretch: <face.stretch>; unicode-range: <face.unicodeRange>; font-feature-settings: …; font-variation-settings: … }` を `<style data-kumiori-fonts>` に書き、
    文書のスタイルシートの最初に置く (`@font-face` は順に依らない)。
  - 渡されていないか、`undefined` を返したら、`snapshot/font-face-source-unknown` の警告 (書体のファミリー名を出す)。組むと、別の書体になる。
  - `status` が `loaded` でない書体 (読み込みに失敗・まだ読んでいない) は、書き出さない。
- 別の案 (9 の決め 7): ページの JS が動く前に `FontFace` の作り手を包む関数 (`captureFontFaces()`) を出し、作るときの中身 (ArrayBuffer か URL) を覚えておく。
  利用者がページの初めに呼ぶ必要があり、他人のコードを書き換えるので、0.6.0 では入れない。次の段の `--render-js` では、ページの前にスクリプトを入れられる
  (Playwright の `addInitScript`) ので、そちらで考える。

### 3.7 相対の URL の基準

- 仕様: HTML §2.4.1 (文書の基準の URL。`<base href>` があればそれ、無ければ文書の URL)、§2.4.2 (URL を解決する)、URL Standard §4.4 (URL の読み方)。
  CSS の中の相対の URL は、そのスタイルシートの URL を基準にする (CSS Values 4 §4.5.1)。
- Kumiori は基準の URL を選択肢で受けないので、写しの中の URL を全部、絶対の URL に書き換える (9 の決め 3):
  - 要素の属性: `img`・`source`・`input type=image`・`script` (取り除く) の `src`、`link`・`a`・`area` の `href`、`video` の `poster`、`object` の `data`、
    SVG の `href`・`xlink:href` (`image`・`use`・`a`・`feImage`・`textPath`・`pattern`・`linearGradient` などの参照)、`blockquote`・`q`・`del`・`ins` の `cite`。
    値は `new URL(値, doc.baseURI).href` で解く (IDL の `img.src` などは解いた値を返すが、SVG と CSS の値には無いので、同じ手で揃える)。
  - **文書の中を指す参照は、そのまま残す**: `#id` だけの参照 (`<a href="#sec2">`・SVG の `url(#grad)`・`<use href="#icon">`) は書き換えない。
    `href` が、文書の URL と同じで `#` の後だけ違うもの (`page.html#sec2` と書いたもの) も `#sec2` にする。絶対の URL にすると、Kumiori は文書の外へのリンクとして扱い、
    PDF の中のリンク (内部のリンク) にならない。
  - `srcset` (`img`・`source`): Kumiori は `srcset` を読まない。画面で選ばれた画像 (`img.currentSrc`) を `src` に書き、`srcset`・`sizes` を取り除き、
    `<picture>` の `<source>` を取り除く (画面の幅で選んだ画像になる。紙では高い解像度の方がよいことがあるが、選び直す手段は無い)。
  - `style` の属性と `<style>` の中の `url(…)`: `src/cssUrlScan.ts` の走査の考え (長さに比例した手間) で `url()` と `@import` の文字列を探して書き換える。
    `<style>` の基準は文書の基準。書き出した CSSOM の規則は、そのスタイルシートの `href` (無ければ文書の基準)。
  - `<base>` の要素は、書き換えた後で取り除く。
  - `javascript:` の URL の `href` は取り除く (4.3)。
- 文書の URL が `file:` か `about:blank` (`srcdoc`・JS で作った文書) のとき: `file:` の絶対の URL は Kumiori のブラウザの取得 (http(s) だけ) で取れないので、
  画像は読めない。`snapshot/relative-url-unresolvable` の警告は出さず (組むときに Kumiori の読めない画像の警告が出る)、説明書に書く。

### 3.8 そのほか、文字にすると変わるもの

- `<noscript>`: 画面は JS が動いていたので、中身は出ていない。Kumiori (`DOMParser`。scripting が無効) は中身を組むので、取り除く。
- `<iframe>`: 中の文書は文字にならない (`outerHTML` は `iframe` の要素だけ)。この段では扱わず、`snapshot/iframe-skipped` の警告 (同じ origin の中の文書を
  入れ子で写して `srcdoc` に入れるのは、要る声があれば足す)。
- 要素の大きさを JS で画面の幅から測って置いたもの (`getBoundingClientRect` で決めた位置・大きさを `style` に書いたもの) は、画面の幅のまま残る。
  紙の本文の幅で組み直しにならない。取る前に画面の幅を紙の本文の幅に合わせれば和らぐ (説明書に書く。`--render-js` では、ビューポートの幅を選べる)。
- ページに分けた後で動く JS (Paged.js の hooks、Prince の `Prince.registerPostLayoutFunction` のようなもの) は、Kumiori には無い。
  ページ番号・柱・相互参照の多くは、CSS の `target-counter()`・`string-set`・`counter(page)` で書ける (説明書に書く)。

### 3.9 診断 (警告の名前)

`snapshot/` の名前で、`src/diagnostics.ts` の `DIAGNOSTIC_CODES` と `docs/diagnostics.md` (日英) の表に足す。どれも `warning`。
`snapshotDocument` が返し、`typeset` の診断には入らない (利用者が両方を見る。説明書に書く)。

| 名前 | 出す時 | 引数 |
| --- | --- | --- |
| `snapshot/wait-timeout` | `timeoutMs` の中で待ち終わらなかった (どれを待っていたかを出す) | `{ waiting: 'load' \| 'fonts' \| 'waitFor' \| 'animations', ms }` |
| `snapshot/canvas-tainted` | 別の origin の画像で汚れた canvas を、画像にできなかった | `{ element }` (id か、要素の場所の短い記述) |
| `snapshot/canvas-too-large` | canvas の画素の数・PNG の大きさが上限を超えた | `{ element, pixels \| bytes, limit }` |
| `snapshot/stylesheet-rule-removed` | `<style>` の元の字にあって、CSSOM から消された規則がある (消せずに残した) | `{ count }` |
| `snapshot/shadow-root-closed` | 閉じた影の根がありそうなカスタム要素 (推し量り) | `{ element }` |
| `snapshot/blob-unreadable` | blob: の URL の中身を読めなかった (消された URL など) | `{ url }` |
| `snapshot/font-face-source-unknown` | JS で足した書体の中身を取れなかった | `{ family }` |
| `snapshot/iframe-skipped` | `<iframe>` の中の文書は写していない | `{ src }` |
| `snapshot/limit` | 取り込んだものの合計が `snapshotBytes` に届いた (その後の canvas・blob: を取り込まない) | `{ limit }` |

- 誤り (投げるもの): DOM の無い所 (`option/invalid`)、選択肢の誤り (`TypeError`)、止めた (`AbortError` の `DOMException`)。

### 3.10 作り (src の中の置き場所と、呼び出しごとの文脈)

- `src/snapshot.ts` (本体・選択肢の確かめ)。セレクタの書き換えと CSS の URL の書き換えは、DOM の要らない純な関数にして `src/snapshotCss.ts` に分け、
  Node の試験 (vitest) で確かめる。
- `src/index.ts` から `snapshotDocument` と型 (`SnapshotOptions`・`DocumentSnapshot`) を出す。
- 警告の文は `src/messages.ts` の仕組みで日英を持ち、言語は呼び出しごとの文脈で決める (`lang` を渡せば、それ)。
  `snapshotDocument` は組版の呼び出しと同じく、自分の文脈で走らせ、`src` の決まりのとおり、await はどれも `rejoin(thisCall(), await …)` の形にする
  (`test/callContextAwait.test.ts` が確かめる)。
- 次の段の `--render-js` に向けて: `src/snapshot.ts` が読むのは、`src/snapshotCss.ts`・`src/messages.ts`・`src/diagnostics.ts`・`src/callContext.ts` と型だけにする
  (組版の本体を読まない)。そうすれば、Playwright の `page.evaluate` に入れる 1 つのスクリプトに小さくまとめられる (この段ではまとめない)。

---

## 4. 大きさと安全

### 4.1 大きな canvas・多くの画像

- canvas 1 つ: 画素の数 (`width × height`) が `imagePixels` (既定 1 億。`typeset` の `limits` と同じ名前・同じ既定) を超えたら、取り込まない (`snapshot/canvas-too-large`)。
  組むときも、Kumiori は 1 枚の画像を `imagePixels` で縛るので、取り込んでも組めないものを取り込まない。
  `typeset` で `limits.imagePixels` を上げて組むなら、同じ値を `snapshotDocument` にも渡す (説明書に書く)。縮めて取り込むことはしない (縮めるかは利用者が決める)。
- ファイル 1 つ (canvas の PNG・blob: の中身・書体): `fileBytes` (既定 256MB) を超えたら取り込まない (`typeset` の `fileBytes` と同じ)。
- 取り込む合計: `snapshotBytes` (snapshot だけの上限。既定 512MB。9 の決め 8)。届いたら、その後のものは取り込まずに `snapshot/limit`。
  画面のメモリ (タブの上限は数 GB) と、Worker へ送る写しの大きさを考えた値。
- 取り込みは 1 つずつ順に行い (`toBlob` を同時に多く走らせない)、待つ間に止める合図を確かめる。
- 多くの画像 (`<img>` の http(s)): snapshot は取り込まない (URL を絶対にするだけ)。取るのは Kumiori の `fetchImages` で、その上限 (`fileBytes`・取得の全体の時限) が掛かる。

### 4.2 別の origin の資源 (CORS)

- snapshot が自分で読むのは、同じ文書の中のもの (canvas・blob: の URL・CSSOM) だけで、ネットワークへは出ない。http(s) の資源は、URL を絶対にして Kumiori に任せる。
- そのため、画面では見えていても、Kumiori (ブラウザの `fetch`) が CORS で読めない別の origin の画像は、組むと読めない画像になる
  (`<img>` は CORS 無しでも画面に出せるが、`fetch` では中身を読めない。Fetch Standard §3.2 の CORS の決まり)。
  画面の `<img>` を canvas に描いても、汚れて取れない (HTML §4.12.5.1)。手段は無いので、説明書に書く (同じ origin に置くか、CORS の応答の頭を付ける)。
- `fetchImages`・`fetchStyles` の決まり (取ってよい URL の関数) は、`typeset` の選択肢のまま効く。snapshot は、取る URL を増やさない
  (元の文書が参照していた URL を、絶対にするだけ)。

### 4.3 ページの側の script を文字にしない

Kumiori は JS を動かさない (組む前に `<script>` を取り除く) が、文字にした写しが、サーバーへ送られたり保存されたりすることがあるので、snapshot の側でも取り除く。

- `<script>` (`type` に依らず。`application/json`・`application/ld+json` のデータの島も。中に鍵や利用者の情報があることがある)。
- `on…` の属性 (イベントの扱い手)、`javascript:` の URL の `href`・`src`・`action`、`<iframe srcdoc>` の中身、`<meta http-equiv="refresh">`、`<noscript>` (3.8)。
- 写しは、画面に出ていた中身を、そのまま含む (利用者の入れた値・ログインした人の情報など)。サーバーで組むときは、その扱いに気を付けることを説明書に書く。
  パスワードの値は書かない (3.4)。

---

## 5. 試験の案

### 5.1 Node の試験 (vitest。速い)

`src/snapshotCss.ts` の純な関数:

- セレクタの書き換え (3.3): 複合・結合子・`,`・`:is()` の中・`:host`・`:host(…)`・`:host-context(…)`・`::slotted(…)`・`::part(…)`・擬似要素の位置。
- CSS の URL の書き換え (3.7): 相対・`../`・絶対・`data:`・`#frag`・`@import "…"`・`@import url(…)`・`image-set()`・閉じない `url(` の長い並び (長さに比例した手間)。
- `href` の文書の中を指す参照の見分け (`page.html#x` → `#x`)。
- 規則の並びの差分 (3.2 の書き足す規則の選び方)。

### 5.2 ブラウザの試験 (Playwright の e2e。`e2e/snapshot.spec.ts`)

`e2e/browserBundle.spec.ts` と同じく、`dist-browser/kumiori.js` を読み、`e2e/fixtures/snapshot/` の小さなページを開いて、
ページの中で `snapshotDocument` → `typeset` まで行い、組んだ領域の木を見る。この環境では `KUMIORI_CHROMIUM` の Chromium で走る (CLAUDE.md)。
外部の配布元からは取らず、別の origin は `page.route` で作る。

| 試験 | ページ | 確かめること |
| --- | --- | --- |
| canvas | 2D の API で棒グラフを描く (Chart.js と同じく `devicePixelRatio` 倍で描き、`style` で大きさ) | `files` に PNG (画素の大きさ = canvas の大きさ)、`img` に置き換わり、組んだ画像の大きさが CSS の大きさ |
| canvas (汚れ) | 別の origin (route で作る) の画像を描く | canvas のまま残り、`snapshot/canvas-tainted` |
| CSSOM | styled-components の本番と同じ形 (空の `<style>` に `insertRule`)、`adoptedStyleSheets`、元の字に `string-set` を書いた `<style>` に `insertRule` で足す | 色・余白が組んだ結果に当たる、`string-set` が消えずに柱に出る |
| Shadow DOM | `attachShadow({ mode: 'open' })` のカスタム要素に、名前付きの slot・`:host`・`::slotted`、入れ子の影の木。閉じた根のもの | 影の木の字が順に組まれ、色が当たり、外に漏れない。閉じた根は `snapshot/shadow-root-closed`、`shadowRoots` で渡せば入る |
| フォーム | text・checkbox・radio・select・textarea に値を入れ、password も入れる | 写しの属性に値があり、password の値が無い |
| blob: | blob: の画像 (消さないもの・読み終えて `revokeObjectURL` したもの)、CSS の背景の blob: | `files` に入り組める。消した背景は `snapshot/blob-unreadable` |
| FontFace | `new FontFace('MyFace', buf)` を `document.fonts.add`、`fontSources` で中身を返す / 返さない | 字が渡した書体で組まれる / `snapshot/font-face-source-unknown` |
| URL | `<base href="sub/">` と相対の `img`・`link`、`<a href="#x">`・`<a href="page.html#x">`、`srcset` | 画像と CSS が route で取られて組まれる、内部のリンクが PDF の内部のリンクになる、`currentSrc` の画像 |
| 待つ | `waitFor` の関数 (1 秒後に真)、届かない合図 (`timeoutMs: 200`)、`signal` で止める | 合図の後の DOM で組む、`snapshot/wait-timeout`、`AbortError` |
| script | `<script>`・`onclick`・`javascript:`・`<noscript>`・JSON の島 | `html` に残らない |
| Worker | 画面で snapshot、Worker へ送って組む | `structuredClone` でき、同じ結果 |

- 実の Chart.js・styled-components は、開発の依存に足さない (9 の決め 9)。手で同じ形を作った試験で確かめ、実のものは作る段で 1 度、手元で確かめて結果を
  コミットの文に書く (依存を足すと、`package-lock.json` の更新と、依存の更新の確かめの手順が掛かる)。
- e2e の時間の増え: 試験 11 個。どれも小さな文書 (1〜2 ページ) を組むので、組版が 1 つ 1〜3 秒 (書体の読み込みを含む。書体は `e2e/fontCache.ts` で覚える)。
  1 つのページで続けて組める試験はまとめ、合わせて 30〜60 秒ほどの増えと見込む (作る段で測って、コミットの文に書く)。

---

## 6. 説明書

`docs/library.md` と `docs/en/library.md` に、「ブラウザで印刷プレビューを出す」の後に、新しい節を足す:
「## JS が組み上げたページを組む (snapshotDocument)」(英語版は「## Typesetting a page built by JavaScript (snapshotDocument)」)。

- 最初の例 (1.1 の使い方) と、Web Worker で組むときの流れ (1.3)。
- 待つ仕組み (1.4) と、Chart.js などのアニメーションの扱い (切るか、終わりで合図)。
- 取れるもの (canvas・CSSOM・開いた Shadow DOM・フォームの値・blob:・CSS の書体・`fontSources` の書体・相対の URL) と、取れないもの
  (別の origin で汚れた canvas・別の origin の CSS の JS で足した規則・閉じた Shadow DOM (`shadowRoots` で渡せば入る)・`fontSources` の無い JS の書体・
  CORS の無い別の origin の画像・`<iframe>` の中・作ったスタイルシートのブラウザが知らない指定)。
- 近似するもの: Shadow DOM のスタイルの詳しさ、`srcset` の画面の幅での選択、画面の幅で測った JS の配置、ページに分けた後で動く JS の代わり
  (`target-counter()`・`string-set`)。
- 上限 (`imagePixels`・`fileBytes`・`snapshotBytes`) と、`typeset` の `limits` と同じ値を渡すこと。
- 安全: script を取り除くこと、写しに画面の中身 (利用者の情報) が入ること、パスワードを書かないこと。
- 警告の名前は `docs/diagnostics.md` (日英) の表に足し、説明書からはそこを指す。
- `CHANGELOG.md` の 0.6.0 に足す (日英の対の決まりに合わせる)。`docs/library.md` の「入口の関数」の一覧にも 1 行足す。

---

## 7. 大きさの見積もりと、作る段のコミット

- `src/snapshot.ts`: 600〜800 行 (待つ・写しと組・canvas・フォーム・blob:・URL・script・CSSOM・Shadow DOM の展開・書体・上限・診断)。
- `src/snapshotCss.ts`: 250〜350 行 (セレクタの書き換え・CSS の URL の書き換え・規則の差分)。
- 試験: Node 150〜250 行、e2e 350〜450 行と見本のページ 10 個ほど。
- 説明書: 日英それぞれ 80〜120 行と、診断の表 9 行ずつ。

台帳の大きさ「中」より少し大きい (Shadow DOM のスタイルの書き換えの分)。作る段は 5 回のコミットに分ける:

1. 骨組み: `snapshotDocument` の入口・選択肢の確かめ・DOM の無い所の誤り・待つ仕組み・写しと組・script と動かす所の取り除き・URL を絶対に (文書の中を指す参照を残す)・
   `srcset`・フォームの値・`snapshot/` の診断の名前 (`DIAGNOSTIC_CODES` と診断の表の型だけ)・Node の試験。
2. CSSOM (差分を書き足す・作ったスタイルシート・CSS の中の URL)・canvas・blob:・上限。
3. Shadow DOM (平らな木への展開・セレクタの書き換え・閉じた根の推し量り) と書体 (`@font-face` を書き足す・`fontSources`)。
4. e2e の試験 (5.2) と、そこで見つかった直し。e2e の時間を測る。
5. 説明書 (日英。library・diagnostics・CHANGELOG)。

どのコミットも `npm run typecheck`・`npm test`、4 からは `npm run e2e` も通す。組版の本体は変えないので、組版の結果 (指紋・前と後の組み比べ) は変わらない
(1 で `npm run compare:base` を回さないでよいことを、指紋の試験が変わらないことで確かめる)。

---

## 8. 次の段 (この束の外)

- Node のコマンドの `--render-js`: Playwright で開き (Chromium は入っているときだけ使う任意の依存。ブラウザの要らない良さは残す)、ビューポートの幅を紙の本文の幅にし、
  `addInitScript` で `FontFace` の中身を覚え (3.6 の別の案)、待って、同じ `snapshotDocument` で文字にして組む。
- Kumiori の HTML の組版で、宣言の Shadow DOM (`<template shadowrootmode>`) を読む (読めれば 3.3 の展開を、そちらに任せられる)。
- フォームの部品の中の値の字を描く (3.4)。

---

## 9. 決めたこと (推奨を最初に並べた候補。どれも推奨の案に決まった)

1. **出す入口**
   - (推奨) `src/index.ts` から出す (`kumiori` と `kumiori/browser` の両方。型も同じ)。DOM の無い所では誤りにする。
   - `kumiori/browser` だけの入口 (`src/browser.ts` を足し、`dist-browser` をそこから作り、型を `browser.d.ts` に分ける)。`kumiori` をバンドラーで使う人は使えない。
2. **返す形**
   - (推奨) `{ html, options: { kind, name, files }, baseUrl, diagnostics, warnings }`。`typeset(snap.html, { ...snap.options, … })` で渡す。書体は `files` と `@font-face`。
   - 台帳の案の `{ html, files, fonts, baseUrl }` (`typeset(snap.html, { files: snap.files, fonts: snap.fonts })` と、名前を 1 つずつ渡す。JS の書体の別名は当たらない)。
3. **基準の URL**
   - (推奨) snapshot が文書の中の URL を全部、絶対にする (`typeset` は変えない)。
   - `TypesetOptions` に `baseUrl` を足し、文書の中の相対の参照を、それで解いて取る (ほかの使い方 (サーバーで HTML を組む) にも役に立つが、`files` の名前との兼ね合い
     (相対の参照を、`files` で引くか、URL で取るか) を決める仕事が増え、組版の側の変更になる)。
4. **Shadow DOM のスタイル**
   - (推奨) 平らな木に展開し、影の木のセレクタを属性で囲うように書き換える (紙の幅で組み直せる。詳しさが少し違う近似)。
   - 影の木の中の要素の計算した値を `style` に書く (セレクタの書き換えが要らないが、長さが画面の幅で決まり、`::before`・`::after` が落ちる)。
5. **フォームの部品** (作る段の初めに、Kumiori が部品の中の値の字を描くかを確かめてから)
   - (推奨) 属性に書くだけ。描かなければ、描くことを別の項目にする。
   - `forms: 'text'` の選択肢で、値の字の `<span>` に置き換えられるようにする。
6. **待つ時間が過ぎたとき**
   - (推奨) その時の DOM で文字にし、`snapshot/wait-timeout` の警告を出す (既定 10 秒)。
   - 誤り (`KumioriError`) にする。または、選択肢で選べるようにする。
7. **JS で足した書体 (FontFace) の中身**
   - (推奨) `fontSources` の呼び返しで利用者が渡す。無ければ警告。`FontFace` を包む関数は、次の段の `--render-js` で考える。
   - 0.6.0 で `captureFontFaces()` (ページの初めに呼ぶと、`FontFace` の作り手を包んで中身を覚える) も出す。
8. **取り込む合計の上限 `snapshotBytes`**
   - (推奨) snapshot だけの上限として、既定 512MB。上げ下げできる。
   - `KumioriLimits` に足して、`typeset` の `limits` と同じものを渡せるようにする (`typeset` は使わない名前が入る)。
   - 合計の上限を設けない (`fileBytes` だけで縛る)。
9. **試験の Chart.js・styled-components**
   - (推奨) 開発の依存に足さず、手で同じ形のページを作って試す。実のものは作る段で 1 度、手元で確かめる。
   - 開発の依存に足し、実のもので e2e を回す (依存の更新の手順と、e2e の時間が増える)。
