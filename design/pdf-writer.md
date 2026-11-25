# PDF の書き出しを自前にする・流し書き、の設計の覚え書き

0.7.0 で、PDF の書き出しの層 (オブジェクトを番号の順に並べ、相互参照を書く所。いまは pdf-lib の `PDFDocument.save`) を自前の書き手にし (束 P1)、
その上に、PDF をページごとに書き出し先へ流す口 (束 P2) を作る設計です。あわせて、pdf-lib に頼っている所の全体を調べ、外す順を見積もります。
作る前に、取りまとめ役が見る。この覚え書きは、リリースする文書 (`docs/` など) ではありません。

前提にしたもの:

- 利用者の決め (2026-11-22): 0.7.0 では、書き出しの層だけを自前にし、その上に流し書きを作る。書体・画像の埋め込みと、PDF/X・PDF/A の検査で PDF を読む所は、
  0.7.0 では pdf-lib のまま (見積もりだけして、0.8.0 以降)。
- `design/partial-and-streaming.md` の 1.2・3〜6 節 (流し書きの調べ。0.6.0 では作らず、0.7.0 に送ったもの)。この覚え書きは、その 3.2 の案を見直して、
  P1 (書き手の置き換え) と P2 (流す口) に分けたもの。重なる所は、向こうの節を指す。
- 組版の側を、ページの境目で止めて続きから組める形にする作り替えは、束 T0 の担当が `design/resumable-flow.md` に書く。この覚え書きは、PDF の側の口だけを書く (3.5)。
- 調べた版: pdf-lib 1.17.1 (2021 年。これより新しい版は無い)・@pdf-lib/fontkit 1.1.1 (2022 年)・fontkit (上流の foliojs/fontkit) 2.0.4 と 3.0.0 (2026-11-11)。

## 0. 先に分かったこと (設計の形を決めるもの)

- **pdf-lib の保存は、写せるほど小さい。** `PDFDocument.save` は、前の手順 (ページが無ければ 1 枚足す・フォームの欄の見た目を作り直す・`flush` で書体と画像を埋め込む) の後、
  2 つの書き手のどちらかで書く。ふつうの PDF と PDF/X-4・PDF/A はオブジェクトの流れと相互参照の流れの書き手 (`PDFStreamWriter`。110 行)、
  PDF/X-1a・X-3 (PDF 1.3・1.4) と、PDF の画像の埋め込む前の検査の試しの PDF は、相互参照の表の書き手 (`PDFWriter`。141 行)。
  どちらも、オブジェクトを番号の順に並べ、決まった形 (`n 0 obj\n` + 中身 + `\nendobj\n\n`) で書くだけで、オブジェクトの中身のバイト列は、オブジェクト自身 (`copyBytesInto`) が作る。
  したがって、**書き手だけを写せば、PDF はいまと同じバイト列になる** (オブジェクトの形は pdf-lib のまま使う)。
- **流して書いたときに、いまと同じバイト列にならない所は 2 つだけ。** 先に書けない流れ (最後に辞書に書き足すもの・最後に作るもの) のうち、
  番号の小さいものがあると、ファイルの中の並びが変わる。それは、タグ付き PDF の印を持つ Form XObject (最後に `StructParents` を書き足す) と、
  pdf-lib に任せている α 付きの PNG (16 ビット・色の表の tRNS・飛び越し。保存のときに作る) だけ (2.4)。
- **文書の ID は、書いたバイト列の SHA-256 から作っている。** いまは、書き終えた配列の全体を 1 度に読んで、印の値を書き換える (`finishDocumentId`)。
  流し書きでは、書いた塊を順に足す SHA-256 (いまの `sha256.ts` は 1 度に読むものだけ) が要り、印の値が最後の塊 (相互参照の流れ・trailer・XMP) にだけあることを確かめる (3.3)。
- **組版の側からは、いまも「先にたどってから描く」形でページを受けている。** `renderPdfPages` は、ページを 1 度たどって、使う書体・画像・色つきの字を集めて埋め込み (番号を取り)、
  それから描く (`PdfPageSource` の `scan` と `paint`)。書体の部分集合の名前 (`AAAAAA+…`) と番号は、この順で決まる。
  組版を 1 回だけ流して、確定したページを順に受ける形 (束 T0) にすると、この「先のたどり」ができないので、どちらかを決める (3.5・5 の 5)。
- **上流の fontkit (3.0.0) に移っても、Kumiori の直しの多くは要る。** TrueType の部分書体の字形のそろえ・hflex の読み・COLR の版 1 は、3.0.0 でも直っていない (1.4)。
  インド系の用字が落ちる元 (`regeneratorRuntime`) は、3.0.0 では無くなっている。移るのは 0.7.0 の外 (1.4・1.5)。

## 1. pdf-lib に頼っている所の調べ

### 1.1 使い方ごとの頼り方

src で pdf-lib を読み込むのは 12 ファイル。@pdf-lib/fontkit を読み込むのは 5 ファイルで、fontkit の中に手を入れる・fontkit の結果を読むファイルを合わせると 11 ファイル (下の表の (h))。
下の「数」は、そのファイルの中の、その種類の名前の出る行の数 (`grep` で数えた、おおよその量)。

| 使い方 | 頼っているファイル (数) | pdf-lib の部品 | 0.7.0 での扱い |
|---|---|---|---|
| (a) オブジェクトの形 (辞書・配列・名前・数・参照・流れ・文脈) | pdfRenderer.ts (161)・pdfxVerify.ts (87)・pdfaVerify.ts (78)・pdfImageEmbed.ts (68)・pdfLibPatches.ts (35)・pdfTags.ts (34)・pdfStreamGuard.ts (31)・colorGlyphPdf.ts (24)・pdfImage.ts (23)・pdfStandard.ts (18)・pdfContentStreams.ts (17) | `PDFDict`・`PDFArray`・`PDFName`・`PDFNumber`・`PDFRef`・`PDFHexString`・`PDFString`・`PDFRawStream`・`PDFFlateStream`・`PDFContext` (`obj`・`register`・`stream`・`flateStream`・`lookup`・`assign`・`nextRef`) | pdf-lib のまま |
| (b) ページと描く命令 | pdfRenderer.ts (167)・colorGlyphPdf.ts (11)・pdfLibPatches.ts (5)・pdfTags.ts (4)・pdfxVerify.ts (3)・pdfImageEmbed.ts (2) | `PDFPage` (`addPage`・`pushOperators`・`node`)・`PDFOperator`・`PDFOperatorNames`・命令の関数 (`pushGraphicsState`・`showText` など)・色 (`rgb`・`cmyk`) | pdf-lib のまま |
| (c) 書き出し (保存) | pdfRenderer.ts (`save` 2 か所: 3287・3290 行)・pdfImageEmbed.ts (`save` 1 か所: 192 行)・pdfStandard.ts (`finishDocumentId`・版の書き換えの前提)・pdfLibPatches.ts (`useDeflate`・`sealPageContents`) | `PDFDocument.save`・`flush`・`PDFStreamWriter`・`PDFWriter`・`PDFHeader`・`PDFTrailer`・`PDFCrossRefStream`・`PDFObjectStream`・`PDFCrossRefSection`・`PDFTrailerDict` | **自前にする (P1)** |
| (d) 書体の埋め込み | pdfRenderer.ts (38)・pdfLibPatches.ts (25)・drawio/drawioText.ts (6。標準の書体の字の幅だけ)・fontSanity.ts・fontkitShaping.ts (各 1) | `embedFont`・`PDFFont`・`CustomFontEmbedder`・`CustomFontSubsetEmbedder`・`StandardFontEmbedder`・`StandardFonts` (フォームの欄の Helvetica・ZapfDingbats) | pdf-lib のまま |
| (e) 画像の埋め込み | pdfLibPatches.ts (30)・pdfRenderer.ts (12)・colorGlyphPdf.ts (5) | `embedJpg`・`embedPng`・`PDFImage`・`PngEmbedder` (原型の上に、自前の埋め込みを作る) | pdf-lib のまま (P2 で、先に埋め込む所だけ変える。2.4)。**0.8.0 で自前にした (11 節)** |
| (f) フォームの欄 | pdfRenderer.ts (`addFormFields`・`checkAppearance` など。3860〜4110 行) | `getForm`・`PDFWidgetAnnotation`・欄の `updateAppearances` | pdf-lib のまま |
| (g) PDF を読む | pdfxVerify.ts (10)・pdfStreamGuard.ts (9)・pdfaVerify.ts (6)・pdfImageEmbed.ts (4)・pdfRenderer.ts (2) | `PDFParser`・`decodePDFRawStream`・`PDFObjectCopier` (PDF の画像を写す)・`PDFDocument` の内の作り方 (`loadWithoutCopy`) | pdf-lib のまま |
| (h) 書体を読む・字を並べる (fontkit) | fontManager.ts (32)・fontkitShaping.ts (40)・fontSanity.ts (27)・pdfRenderer.ts (26)・fontkitCffFlex.ts (23)・colorGlyph.ts (17)・fontLoader.ts (9)・fontkitEmptyGlyph.ts (8)・api.ts (7)・webFont.ts (6)・colorGlyphPdf.ts (3) | `@pdf-lib/fontkit` の `create`・`layout`・`getGlyph`・`createSubset`・WOFF2 の Brotli の展開 | @pdf-lib/fontkit のまま (1.4) |

### 1.2 自前にするときの見積もり

行数は、自前のコード (試験を除く) の見込み。測っていない (大づかみ)。

| 使い方 | 行数 | 危うさ | 前と後で同じことの確かめ方 |
|---|---|---|---|
| (c) 書き出し | 250 (2 つの書き手・前の手順・圧縮の差し替えの取り込み) | 低い。写すだけで、出来た PDF を `save` の結果とバイトで比べられる | 同じ文書を `save` と自前の書き手の両方で書き、バイト列が同じ (2.3)。`compare:base` で、組める文書の全部の PDF のバイト列が同じ |
| (e) 画像の埋め込み | 300 (JPEG の頭を読んで DCTDecode の辞書を作る 80・pdf-lib に任せている PNG の形 (16 ビット・色の表・tRNS・飛び越し) の展開と SMask 200。8 ビットの PNG は、もう自前) | 中。PNG の変わった形が多い。pdf-lib の圧縮 (pako) と同じバイトにはならないので、その画像を含む文書は PDF が変わる | 画像の辞書の値 (大きさ・色空間・ビット) と、展開した画素が同じこと (試験)。`compare:base` で変わる文書が、pdf-lib に任せていた PNG を含む文書だけで、ページの絵が同じ (`compare-pdf.mjs` の画素の比べ) |
| (d) 書体の埋め込み | 800〜1,000 (Type0・CIDFontType2・FontDescriptor・W の配列・ToUnicode の CMap・部分書体の印・TrueType の部分書体の書き手 (fontkit の `createSubset` を使い続けるなら要らない)。CFF の部分書体は、もう自前 (`cff.ts`)) | 高い。字のある全部の PDF に効く。見る側 (Acrobat・pdf.js・Poppler) ごとの癖がある | pdf-lib と同じ形 (W の書き方・CMap の文) で書けば、バイト列まで同じにできる (決まった書き方なので)。`compare:base` で全部の文書が同じ。違えば、veraPDF と `pdffonts`・字の取り出し (`pdftotext`) で確かめる |
| (f) フォームの欄 (と標準の書体の字の幅) | 800 (AcroForm・欄の辞書・見た目の流れ・Helvetica と ZapfDingbats の字の幅の表 300) | 高い。欄の種類ごとの見た目。使う文書は少ない | 欄のある見本で、バイト列か、欄の辞書と見た目の絵が同じ |
| (a)(b) オブジェクトの形・描く命令 | 1,500 (オブジェクトの型・文脈・書き方・数の書き方・命令) と、使う所の書き換え (数千行に触る) | 中 (機械的だが量が多い) | バイト列まで同じにできる (書き方を写す)。`compare:base` |
| (g) PDF を読む | 1,500 (字句・相互参照の表と流れ・オブジェクトの流れ・壊れた相互参照の直し・圧縮の方式 (Flate・LZW・ASCII85・ASCIIHex・RunLength)・写し手) | 高い。外から来た PDF (PDF の画像) を読むので、安全に効く。`pdfStreamGuard.ts` が、いまも縛りを外から掛けている | 検査の結果 (PDF/X・PDF/A の誤りの一覧) と、PDF の画像の埋め込みの結果が同じ。壊れた PDF の試験 (いまの試験) が同じに断る |

合わせて 5,000〜5,500 行ほど (台帳の大づかみの 3,000〜5,000 行より少し多い)。(c) だけが小さく、確かめ方も強い (バイトで比べられる)。

### 1.3 `src/pdfLibPatches.ts` の差し替え 8 つの行き先

| # | 差し替え | 層 | 行き先 |
|---|---|---|---|
| 1 | TrueType の部分書体の字形を 4 バイトにそろえる (`patchFontkitSubset`。読めない字形を空にする所・書き出しの例外を受ける所を含む) | (d)(h) | 書体の埋め込みを自前にするとき (0.8.0 以降) に、自前の部分書体の書き手に入れる。fontkit 3.0.0 でも直っていない (1.4) |
| 2 | CFF の OpenType を CIDFontType0C で埋め込む (`patchCffEmbedding`) | (d) | 書体の埋め込みを自前にするとき、その本体になる (CFF の部分書体は、もう `cff.ts` が作っている) |
| 3 | PNG の IDAT をそのまま FlateDecode の画像にする (`embedPngAsIs`。自前の展開の `decodedPngEmbedder`・CMYK の画像も同じ形) | (e) | 画像の埋め込みを自前にするとき、`PngEmbedder` の原型を借りずに、画像の XObject を直に作る形にする。**0.8.0 でそうした (11 節。差し替えは消え、`src/imageEmbed.ts` に移った)** |
| 4 | `encodeText` を覚えるものにし、字形の番号から符号にする (`memoEncode`) | (d) | 書体の埋め込みを自前にするとき、自前の符号の作り方になる |
| 5 | 圧縮の関数を替える (`useDeflate`) | (c) | **P1 で書き手に取り込む**。書き手が、書くときに、圧縮する流れ (`PDFFlateStream`) を渡された関数で圧縮する (いまと同じバイト列。2.2)。差し替えは消す |
| 6 | ページの命令の並びをじかに読み書きする (`pageOperators`) | (b) | ページの形を自前にするまで残す (0.8.0 より後。外さなくてもよい) |
| 7 | 描き終えたページの中身の流れを、圧縮したバイト列に置き換える (`sealPageContents`・`sealContentStream`) | (b)(c) | 0.7.0 では残す。P2 は、ここを「先に書いてよい」所にする (3.2)。ページの形を自前にするとき、その中に入れる |
| 8 | 小さい数・有限でない数を抑える (`patchSmallNumbers`) | (a) | オブジェクトの形が pdf-lib のうちは残す (P1 の書き手は、数の書き方に触らない)。オブジェクトの形を自前にするとき、自前の数の書き方に入れる |

0.7.0 で消えるのは 5 だけ。7 は P2 の土台として使い続ける。

### 1.4 @pdf-lib/fontkit から上流の fontkit へ移れるか (見通し)

@pdf-lib/fontkit 1.1.1 は、上流の fontkit 1.x を pdf-lib の作者が包み直したもので、2022 年から更新が無い。上流は 2.0.4 (2024-08) と 3.0.0 (2026-11-11) がある。
3.0.0 の配布物 (dist/node) を読んで確かめたこと:

| 点 | 3.0.0 | Kumiori の側 |
|---|---|---|
| 形 | ES モジュールだけ (`type: module`。Node 向けとブラウザ向けの 2 つの配布物)。依存は restructure 3・brotli・fflate・unicode-trie・unicode-properties・dfa | Kumiori も ES モジュール。束ねる道具 (Vite) で読めるかは、作る段で確かめる |
| 部分書体の書き出し | `subset.encode()` がバイト列を返す (`encodeStream` は無い) | pdf-lib の `CustomFontSubsetEmbedder.serializeFont` は `encodeStream` を呼ぶので、そのままでは pdf-lib と組めない。Kumiori は `serializeFont` を差し替えている (差し替え 1) ので、そこで `encode()` を呼べばよい (いまより簡単になる) |
| CFF の部分書体 | `createSubset` が CFF の書体にも部分書体 (`CFFSubset`) を返す | Kumiori は自前の `cff.ts` を使うので、使わない |
| TrueType の部分書体の 4 バイトのそろえ | 直っていない (`_addGlyph` が字形のデータをそろえずに足す) | 差し替え 1 は要る |
| CFF の hflex の読み | 直っていない (hflex の最後の制御点と終点の y を、始点の y に戻さない) | `fontkitCffFlex.ts` の 1 は要る |
| FDSelect の範囲 | 二分探索の作りは同じに見える | `fontkitCffFlex.ts` の 2 が要るかは、その試験で確かめる |
| COLR | 版 0 の表しか読まない | `colorGlyph.ts` の版 1 の読みは要る |
| インド系の用字・タイ文字 | 音節に分ける処理は、変換していないジェネレータになり、`regeneratorRuntime` で落ちる元は無い。タイ・ミャンマー・ヘブライの整形を持つ | `fontkitShaping.ts` の 15 の補いのうち、いくつかは要らなくなる見込み。どれが要るかは、その試験で 1 つずつ確かめる |
| 字のバイト列の型 | ブラウザ向けの配布物に `Buffer` が出ない (`Uint8Array`) | `pdfLibPatches.ts` の、fontkit の `Buffer` の型を借りる所 (空の字形・そろえの詰め物) は、`Uint8Array` で書ける |
| 中の名前 (`_addGlyph`・`_getPath`・`fdForGlyph`・`_getBaseGlyph`・`getVariationSelector`) | ある | 差し替えの前提の確かめ (`internal/patch-mismatch`) は、そのまま働く |

見通し: **移れる。ただし 0.7.0 ではしない。** 理由:

- 字の並べ方 (GSUB・GPOS の処理) が 1.x と変わっていれば、組版の結果が広く変わる (領域の木の指紋・`compare:base` の全部の文書)。確かめの量が、P1・P2 と同じかそれ以上。
- 3.0.0 は出て 12 日で、包みに変更の記録が無い。直しの版 (3.0.x) を待ち、GitHub のリリースの説明を読んでからにする。
- pdf-lib に組ませるには、pdf-lib の埋め込み (`CustomFontEmbedder`) が呼ぶ口との食い違い (`encodeStream`・字形の `codePoints` の扱い・`Buffer`) を合わせる差し替えが増える。
  書体の埋め込みを自前にするとき (0.8.0 以降) に、一緒に移ると、この合わせが要らない。

### 1.5 外す順の案

1. **0.7.0: 書き出し (c)** (P1)。小さく、バイトで比べられ、流し書き (P2) の土台になる。
2. **0.7.0: 流し書き** (P2)。
3. 0.8.0: 画像の埋め込み (e)。小さく、ほとんどもう自前。先に埋め込む作り (P2 の 2.4) とも合う。**済み (11 節)**。
4. 0.8.0 以降: 書体の埋め込み (d) と、上流の fontkit への移り (h)。一緒にする (1.4)。標準の書体の字の幅も、ここで表を持つ。
5. その後: フォームの欄 (f)。使う文書が少ないので、急がない。
6. 外さなくてもよいもの: オブジェクトの形と描く命令 (a)(b)、PDF を読む所 (g)。(a)(b) は量が多いだけで、困っていることが無い。(g) は、読む所の安全を自前で持つ重さが大きい。
   pdf-lib に直せない誤りが見つかったときは、その部分だけを取り込む (pdf-lib は MIT。`THIRD_PARTY_NOTICES.md` に、もう載っている) か、自前にする。

pdf-lib が持ち続ける pako 1 (`THIRD_PARTY_NOTICES.md` の pako の 2 つの版) は、(a)(b) のうち、`PDFFlateStream`・オブジェクトの流れ・相互参照の流れの圧縮に残る。
P1 の書き手が圧縮を自前の関数 (`deflate`) でするようにすれば減らせるが、バイト列が変わる (0.7.0 ではしない。5 の 2)。

## 2. 束 P1: 自前の書き手

### 2.1 置き場所と形

新しいモジュール `src/pdfWriter.ts`。pdf-lib の書き手を写し、始まりの位置と書き出し先を変えられる形にする (pdf-lib を書き換えない)。

```ts
export interface PdfWriteOptions {
  /** オブジェクトの流れ (ISO 32000-1 §7.5.7) と相互参照の流れ (§7.5.8) で書く (既定)。false なら相互参照の表 (§7.5.4) と trailer (§7.5.5) */
  objectStreams?: boolean;
  /** 見出しの版 (既定 '1.7')。PDF/X-1a は '1.3'、X-3 は '1.4'、X-4 は '1.6' (いまは書いた後に先頭の 8 バイトを書き換えている) */
  version?: string;
  /** 圧縮する流れを、この関数で圧縮する (いまの useDeflate)。オブジェクトの流れと相互参照の流れには当てない (いまと同じ) */
  deflate?: (d: Uint8Array) => Uint8Array;
  /** ページが無ければ 1 枚足す (pdf-lib の save と同じ。既定 true) */
  addDefaultPage?: boolean;
}
/** PDFDocument.save と同じ PDF を書く (前の手順・オブジェクトの並び・バイト列が同じ) */
export async function writePdf(pdf: PDFDocument, opts?: PdfWriteOptions): Promise<Uint8Array>;
```

- 前の手順は `save` と同じ: ページが無ければ足す (`addDefaultPage`)・フォームの欄の見た目を作り直す (`getForm` の覚えがあれば `updateFieldAppearances`。
  pdf-lib の内の覚え (`formCache`) を読まずに済むよう、Kumiori が欄を作ったかを渡す形にしてもよい。作る段で決める)・`flush`。
- 書き方 (`PDFStreamWriter` の写し): 見出し (`PDFHeader.forVersion`。2 進の印の行を含む) + 改行 2 つ → 番号の順に、流れと、圧縮しないもの
  (暗号化の辞書・`PDFInvalidObject`・世代が 0 でないもの) → 流れでないものを、番号の順に 50 個ずつオブジェクトの流れにまとめたもの
  (番号は `largestObjectNumber + 1` から) → 相互参照の流れ (その次の番号。`Size` を入れる) → `startxref` と `%%EOF` (`PDFTrailer`)。
  オブジェクトの流れと相互参照の流れは、pdf-lib の部品 (`PDFObjectStream.withContextAndObjects`・`PDFCrossRefStream.create`) をそのまま使う (圧縮も pdf-lib の pako のまま)。
- 相互参照の表の書き方 (`PDFWriter` の写し): 番号の順に全部 → 相互参照の表 (`PDFCrossRefSection`) + 改行 → trailer の辞書 (`PDFTrailerDict`) + 改行 2 つ → `startxref` と `%%EOF`。
- trailer の辞書の中身と並び (`Size`・`Root`・`Encrypt`・`Info`・`ID`。無いものは書かない) は、pdf-lib の `createTrailerDict` と同じ。
- 50 個ごとに間をあける (pdf-lib の `waitForTick`。`setTimeout(0)`) のは、写さずに、Kumiori の止める合図の間 (`pause`) にする (バイト列には関わらない)。
  間をあけた後は `rejoin(thisCall(), …)` で呼び出しの文脈に戻る (`test/callContextAwait.test.ts`)。
- 書いた配列は、いまと同じに 1 つの `Uint8Array` (大きさを先に数えてから作る)。流すときの形は P2 (3.2)。

### 2.2 いまと同じバイト列になる条件

次のどれもが成り立てば、`writePdf(pdf, o)` は `pdf.save(…)` (+ いまの版の書き換え・`useDeflate`) と同じバイト列になる。試験で確かめる (2.3)。

1. 同じ前の手順を、同じ順で踏む (ページを足す → 欄の見た目 → `flush`)。`flush` を先に呼んである文書 (縦書きの書体・`deflate`・PDF/A で、いまも先に呼んでいる) では、
   2 度目の `flush` は何もしない (pdf-lib の埋め込みは 1 度だけ)。
2. オブジェクトを `enumerateIndirectObjects()` の順 (番号の小さい順) で並べ、流れか否かの分け方・50 個の区切り・新しく取る番号が同じ。
3. オブジェクトの中身は、オブジェクト自身が書く (`sizeInBytes`・`copyBytesInto`。圧縮の覚え (`contentsCache`) も、オブジェクトが持つまま)。
4. 圧縮の差し替え: `useDeflate` は、`flush` の後に文脈にある `PDFFlateStream` (圧縮する印のあるもの) の覚えを差し替えている。書き手が、`flush` の後に、
   同じものに同じ関数を当てれば同じ (書き手が作るオブジェクトの流れ・相互参照の流れは、文脈に無いので当たらない。いまも当たっていない)。
5. 版の書き換え: いまは、書いた後に先頭の `%PDF-1.7` (8 バイト) を同じ長さの版で書き換えている (`pdfRenderer.ts` の 3292 行)。見出しを版で書けば同じ (2 進の印の行は同じ)。
6. 文書の ID: いまのとおり、書き終えた配列に `finishDocumentId` を当てる (P1 では変えない)。

当てはまらないのは、pdf-lib の版が変わったとき (部品の書き方が変わる) だけ。pdf-lib は 1.17.1 に止める (`package.json` の `^1.17.1` を `1.17.1` にするかは、5 の 3)。

### 2.3 試験と確かめ

- `test/pdfWriter.test.ts`: 同じ `PDFDocument` を、自前の書き手と `pdf.save()` の両方で書いて、バイト列が同じ (書き手は文書を変えないので、同じ文書を 2 度書ける。
  先に自前で書き、次に `save`。逆の順でも)。文書は、いまの試験の PDF を作る所を通すもの: ふつう・PDF/X-1a・X-3・X-4・PDF/A-2b・3b・PDF/X-4 と PDF/A・タグ付き PDF・PDF/UA-1・
  `deflate` を渡したもの・縦書き・色つきの字・SVG・JPEG・PNG の各形 (pdf-lib に任せる α 付きを含む)・PDF の画像・リンク・しおり・フォームの欄・添付・ページの無い文書
  (ページが無いときに 1 枚足すこと)・オブジェクトが 50 個ちょうど・51 個 (オブジェクトの流れの区切り)。
  比べるために、`renderPdfPages` に、書く所を取り替える試験用の口 (`PdfRenderOptions` の内の選択肢。公開しない) を置き、両方の書き方で出す。
- `test/reproduciblePdf.test.ts` (同じ入力・同じ日時で同じバイト列) が、そのまま通る。
- `npm run compare:base -- --base <P1 の前の main> --head .`: リポジトリの文書と手元の見本 (アンテナハウスのサンプル FO 集・CSS-Print・WeasyPrint の見本) の
  PDF のバイト列が、どれも同じ (変わった文書が 0)。領域の木の指紋は変わらない (組版に触らない)。
- `npm run perf:compare -- --base <P1 の前の main> --head .`: 書く時間が変わらないこと (写しなので、ほぼ同じ見込み)。
- PDF/X・PDF/A の後の検査 (`verifyStandard`・`verifyStandardA`) は、書いた配列を読み直すので、そのまま働く。
- veraPDF・`pdfinfo` は、バイト列が同じなので要らない (同じことを `compare:base` が確かめる)。

### 2.4 作る段 (コミット) と大きさ

| コミット | 中身 | 大きさ (見込み) |
|---|---|---|
| P1-1 | `src/pdfWriter.ts` (2 つの書き方・前の手順・版・`deflate`)・試験 (2.3 の 1 つ目) | コード 250 行・試験 250 行 |
| P1-2 | `pdfRenderer.ts` の `save` 2 か所と `pdfImageEmbed.ts` の 1 か所を `writePdf` にし、版の書き換えと `useDeflate` (差し替え 5) を消す。`THIRD_PARTY_NOTICES.md` は変えない (pdf-lib を使い続ける)。CHANGELOG (日英) に、PDF は前と同じバイト列であることを書く | コード ±80 行 |

P1 だけで main に入れられる (渡すもの・出る PDF は変わらない)。半日〜1 日。

## 3. 束 P2: 流し書き

### 3.1 API の形

`design/partial-and-streaming.md` の 1.2 の形を使う。見直した所だけを書く。

```ts
/** PDF の書き出し先。WritableStream か、バイト列の塊を受ける関数 (Promise を返したら、次の塊の前に待つ) */
export type PdfOutput = WritableStream<Uint8Array> | ((chunk: Uint8Array) => void | Promise<void>);

export interface TypesetPdfStreamResult extends Omit<TypesetPdfResult, 'pdf'> {
  /** 書き出し先に書いたバイト数 */
  bytes: number;
}

export function typesetToPdfStream(text: string, options: TypesetOptions, output: PdfOutput, pdf?: TypesetPdfOptions): Promise<TypesetPdfStreamResult>;
// 器の版
interface Typesetter { typesetToPdfStream(text: string, options: DocumentOptions | undefined, output: PdfOutput, pdf?: TypesetPdfOptions): Promise<TypesetPdfStreamResult> }
// 組んだ結果から
interface TypesetResult { toPdfStream(output: PdfOutput, options?: PdfOptions): Promise<{ bytes: number }> }
```

- 書き出し先の形: `WritableStream` (WHATWG Streams §5) と、塊を受ける関数の 2 つ (推奨。5 の 4)。Node の `Writable` は、じかには受けない:
  `Writable.toWeb(fs.createWriteStream(p))` (Node 17 から。Kumiori の下限の 22.12 にある) か、`(c) => fs.writeSync(fd, c)` を渡す。
  じかに受けると、公開の型に Node の型 (`@types/node`) が入り、ブラウザ向けの型の宣言が汚れるため。`docs/library.md` に、Node での渡し方の例を 2 つ書く。
- `WritableStream` の扱いは、`pipeTo` の既定 (§4.2.5) に合わせる: 書き終えたら `close()`、誤り・止める合図で終えたら `abort(理由)`、終えたら書き手のロックを放す。
  書くたびに `writer.ready` を待つ (背圧)。
- 塊の大きさ: 64KB までためて書く。ページの終わりと最後にも、たまった分を書く。
- `ReadableStream` が欲しい呼び手は `TransformStream` を挟む (`docs/library.md` に例を書く)。

### 3.2 書き手の流す形 (P1 の上に足すもの)

P1 の `src/pdfWriter.ts` に、流す書き手を足す。中の数え方 (位置・番号・オブジェクトの流れの区切り) は P1 と同じものを使う。

```ts
/** PDF を output へ流して書く (writePdf と同じ書き方。書き終えた流れを先に書いて、文書から除く) */
export class PdfStreamWriter {
  constructor(pdf: PDFDocument, output: PdfSink, opts: PdfWriteOptions);
  /** 書き終えた流れ (中身も辞書も、もう変わらないもの) を書いてよいと知らせる */
  release(ref: PDFRef): void;
  /** たまった塊を書き出し先へ渡す (ページの終わりに呼ぶ。書き出し先が待たせるなら待つ) */
  drain(): Promise<void>;
  /** 残りを書く (writePdf と同じ前の手順の後)。書いたバイト数を返す */
  finish(): Promise<number>;
  abort(reason: unknown): Promise<void>;
}
```

- **先に書くのは、番号の順の切れ目まで。** 先に書いてよいと知らされた流れを、番号の小さいものから、切れ目無く続く所まで書く
  (まだ書いてよいと知らされていない流れ (2.4 の止める流れ) があれば、それより大きい番号の流れは、そこで待たせる。流れでないオブジェクトは、いつも最後)。
  こうすると、保存のときに流れを番号の順に書くのと同じ並びになり、**止める流れが無い文書では、ファイルのバイト列まで同じ**になる (2.4・5 の 1)。
- 先に書くもの (描き手が、書き終えたと分かっている所で `release` を呼ぶ):
  - ページの中身の流れ: `sealPageContents` の後。
  - 画像の XObject: 埋め込んだ直後 (JPEG は `PDFImage.embed()` を先に呼ぶ。新しい番号を取らないので、同じ PDF)。SMask も。
  - Form XObject (SVG の描き置き・色つきの字の Form・模様・不透明度のグループ・PDF の画像の Form と、その写した流れ): 作った直後 (`sealContentStream` を通るもの)。
    タグ付き PDF で、中に印の付いた内容を持つ Form は除く (最後に `StructParents` を書き足す。ISO 32000-1 §14.7.4.4)。
  - 色つきの字の手順 (Type 3 の CharProcs): 作った直後。
- 最後に書くもの: 書体のファイル・ToUnicode (部分書体は全部のページの字を見てから作る)・XMP・注釈とフォームの欄の見た目・流れでないもの全部 (ページの辞書の `Annots`・`StructParents` など、後で書き足すものがある)。
- 書いた流れは、位置を覚えて (`Map<番号, 位置>`)、`context.delete(ref)` で文書から除く (`largestObjectNumber` は戻らないので、後の番号は変わらない)。
  除いた後で引かれたら、`lookup` が `undefined` を返して気付ける。試験用の切り替えで、除いたものを引いたら投げるようにして、全部の機能を使う文書を通す (3.7)。
- `finish`: P1 と同じ前の手順の後、残りの流れを番号の順に → オブジェクトの流れ → 相互参照の流れ (先に書いた流れの位置も、番号の順に入れる) → trailer。
  pdf-lib の `PDFCrossRefStream` は、項目を足した順に書き、続く番号の範囲 (`Index`) を前の項目との差で作るので、先に書いた流れと残りのものを番号の順に並べ直してから足す。
- 圧縮の差し替え (`deflate`): 先に書く流れにも、書く時に同じ関数を当てる (最後に当てるのと同じバイト列)。

### 3.3 文書の ID・見出し・PDF/X・PDF/A

- 見出しは、最初のページを描き終えてから書く (描く前に分かる誤り (タグ付き PDF の組み合わせ・`pdfua/requires-tagged` など) は、書き出し先が空のまま投げる)。
- 文書の ID: 書いた塊を順に足す SHA-256 (`sha256.ts` に、足していく形 (`Sha256` の `update`・`digest`) を足す。40 行。いまの `sha256` は、その上に作り直す) で、
  印の値の入ったバイト列を読み、最後の塊 (残りの流れ・オブジェクトの流れ・相互参照の流れ・trailer) を書く前に、その塊も足して ID を決め、最後の塊の印の値を書き換えてから書く。
  印の値が、先に書いた塊にあったら (圧縮したデータの中に、たまたま同じ 16 バイトの並びがあるなど)、いまの `finishDocumentId` が数の合わない印を誤りにするのと同じに誤りにする
  (先に書いた塊は、もう書き出し先にあり書き換えられないので、書き出し先を止める)。XMP の流れは最後に作るので、最後の塊に入る (試験で見張る)。
- PDF/X・PDF/A は流して書けない (推奨。5 の 3): 後の検査が書いた全体を読み直し、合わなければ PDF を返さない約束を、先に書いてしまうと守れない。
  PDF/X-1a・X-3 の透明を平らにする処理も、文書ごとに集めてから描く。`typesetToPdfStream`・`toPdfStream` に `pdfx`・`pdfa` を渡したら、何も書く前に
  `KumioriOptionError` (`api/invalid-option`。「PDF/X・PDF/A は流して書けません。typesetToPdf を使ってください」)。PDF/UA-1・タグ付き PDF は使える。

### 3.4 止める合図・誤り・上限

`design/partial-and-streaming.md` の 4 節のとおり。要点:

- 止める合図 (`signal`): いまのとおり、ページを描く前と、残りを書く前で確かめる。止めたら、`WritableStream` は `abort(理由)`、関数は何もしない。返す Promise は理由で失敗する。
  書き出し先には途中までのバイト列が残る (PDF として読めない)。`docs/library.md` に「止めたり失敗したりしたら、書き出し先の中身は捨てる」と書く。
- 書き出し先の誤り: 組版と書き出しを止め、その誤りをそのまま投げる (包まない)。誤りになった書き出し先は `abort` しない。
- 上限: 流し書きで足す上限は無い (`limits` の表は変えない)。ためる塊は、関数の書き出し先が値を返さないとき 64KB まで。待たせる書き出し先 (Promise・`WritableStream`) で、
  組版の側がページの間で待てないとき (メモリ節約の決まった回の組み直し。`design/partial-and-streaming.md` の 3.5) は、待てる所まで、圧縮したバイト列をためる
  (いまの PDF の側の持ち方より大きくはならない)。
- 同時に走る呼び出し: 書き手は呼び出しごとに作る。await の後は `rejoin(thisCall(), …)`。

### 3.5 組版とのつなぎ (PDF の側の口)

PDF の側は、**組版の側から、確定したページ (もう変わらない `SheetArea`) を順に受け取る**。いまの `PdfPageSource` (`scan` で 1 度たどってから `paint` で描く) の
`paint` が、その受け口になる。流し書きで足すのは、1 枚を描き終えた所 (`sealPageContents` の後) で `release` と `drain` を呼ぶことだけで、
`paint` の受け方 (ページを 1 枚ずつ渡し、Promise を返せばページの間で待つ) は変えない。

束 T0 (止めて続けられる流れ) とのつなぎで、決めることが 1 つある (5 の 5):

- **いまの形のまま (先にたどってから描く)**: 書体・画像・色つきの字は、先のたどりで集めて、描く前に埋め込む (番号を取る)。流さない PDF と同じバイト列になる。
  先のたどりには、全部のページが要るので、組版を 1 回だけ流す作り (T0) とは、そのままでは合わない。T0 の側で、先のたどりのための回 (ページを捨てながら、使う書体と画像だけを集める回) を
  組むか、組んだページの論理の木を、描く回まで持つことになる (メモリ節約の今の作り (`layoutLowMemory`) は、決まった回を組み直して `scan` と `paint` に渡している)。
- **初めて使う所で埋め込む形 (1 回のたどり)**: ページを描くときに、まだ埋め込んでいない書体・画像・色つきの字を、その場で埋め込む。T0 の 1 回の流れと、そのまま合う。
  ただし、埋め込む順と番号が変わるので、流さない PDF も含めて、全部の文書の PDF が 1 度変わる (オブジェクトの中身は同じで、番号と並びと部分書体の印が変わる)。
  確かめは、バイト列の比べでなく、オブジェクトを中身で突き合わせる道具 (作る) と、ページの絵の比べ (`compare-pdf.mjs`) になる。

PDF の側の口は、どちらにしても同じ形 (確定したページを 1 枚ずつ受ける) にしておく。

```ts
/** 組版の側が PDF の側へページを渡す口 (いまの PdfPageSource の paint と同じ受け方) */
interface PdfPageSink {
  /** 確定したページを 1 枚渡す。Promise を返したら、次のページを渡す前に待つ (書き出し先の背圧と止める合図) */
  page(sheet: SheetArea): void | Promise<void>;
  /** 全部のページを渡し終えた (しおり・飛び先は、ここで渡す) */
  end(final: Pick<AreaTree, 'bookmarks' | 'destinations'>): Promise<void>;
}
```

### 3.6 コマンド

- `--pdfx`・`--pdfa` の無い PDF の書き出しは、選択肢を足さずに、いつも流して書く (推奨。5 の 6)。書き出し先は、出力のファイルと同じディレクトリの一時のファイル
  (`<出力>.part-<乱数>`) で、書き終えたら名前を替える。途中で失敗・中断したら一時のファイルを消す (壊れた PDF を残さない。`--watch` で書きかけを開かせない)。
- `--pdfx`・`--pdfa` のときは、いまのとおり全体を作ってから書く。
- 流して書いた PDF は、止める流れの無い文書では、いまと同じバイト列 (2.4・3.2)。

### 3.7 試験

`design/partial-and-streaming.md` の 5 の 3 のとおり。変える所:

- 流した PDF と流さない PDF (日時を止める) の比べ: 止める流れの無い文書は、バイト列が同じ。止める流れのある文書 (タグ付き PDF で SVG に字があるもの・pdf-lib に任せる α 付きの PNG) は、
  オブジェクトの番号ごとに中身のバイト列が同じで、相互参照の位置だけが違う (5 の 1 の推奨のとき)。
- 先に書いて除いたものを後で引かないこと (除いたものを引いたら投げる試験用の切り替え)。
- 書き出し先の 3 つの形 (`WritableStream`・Promise を返す関数・値を返さない関数) と、メモリ節約の有り無しで、同じバイト列。
- 文書の ID: 流した PDF の ID が、同じ PDF を流さずに書いたときの ID と同じ (同じバイト列なら)。印の値が先の塊にある (作った文書) と誤り。
- 止める合図・書き出し先の誤り・PDF/X・PDF/A の誤り・背圧 (遅い `WritableStream` で、ためる塊がページ 1 枚ほどを超えない)。
- 渡さないときに変わらないこと: `compare:base` で、全部の文書の PDF のバイト列が同じ (コマンドは流して書くようになるので、ここで流した PDF も比べることになる)。
- タグ付き PDF: 流した PDF を veraPDF (`node scripts/verapdf.mjs`) にかけ、落ちる規則が流さない PDF と同じ。`pdfinfo -struct-text` で構造の木を見る。

### 3.8 メモリの測り

`scripts/measure-memory.mjs` を足す (`design/partial-and-streaming.md` の 3.4 の測り方)。文書: 対応仕様説明書の 2 つ・文だけの 1,600 ページの文書 (作る)・
画像の多い文書 (pngjs で作る、圧縮の効かない画像 200 枚)・手元の CSS-Print。それぞれを `typesetToPdf` と `typesetToPdfStream` (書き出し先は `fs.writeSync`) で、
メモリ節約の有り無しで組み、`--expose-gc` で始めに片付けてから、JS のヒープ・外のバイト列 (`arrayBuffers`)・RSS の山と、PDF を書く間の山と、時間を出す。
`npm run perf:compare` と同じ形の出力 (文書ごとの表) にし、`docs/development.md` の「組版の時間の比べ」の隣に使い方を書く。

見込み (0.6.0 の覚え書きの測った値から): 文の多い文書では、PDF の側は山の 1% 未満なので、流しても山はほとんど変わらない (山は組版の途中の木。T0 の側で下げる)。
画像の多い文書 (PDF が数百 MB) では、PDF の側が「PDF の大きさの 2 倍ほど」から「いちばん大きい画像 1 つ + 書体 + 辞書 + 64KB」になる。
ただし、いまは画像を描く前に全部埋め込むので、画像を初めて使う所で埋め込む形 (3.5 の 2 つ目) にしない限り、埋め込んだ画像は描く前に全部そろう。
先に書くのは埋め込んだ直後なので、持つのは 1 つずつになる (埋め込む → 書く → 除く、を画像ごとに繰り返す)。

### 3.9 作る段 (コミット) と大きさ

| コミット | 中身 | 大きさ (見込み) |
|---|---|---|
| P2-1 | 流す書き手 (`PdfStreamWriter`: 番号の順の切れ目まで先に書く・塊・3 つの書き出し先・止める・誤り)・足していく SHA-256 と、流すときの文書の ID・試験 | コード 250 行・試験 250 行 |
| P2-2 | `renderPdfPages` に入れる (先に書く所で `release`・ページの終わりで `drain`。流さないときは P1 の `writePdf` のまま)・JPEG と画像の先の埋め込み・試験 (流した PDF と流さない PDF の比べ) | コード 100 行・試験 200 行 |
| P2-3 | 口: `typesetToPdfStream`・器の版・`toPdfStream`・PDF/X・PDF/A の誤り・コマンドの一時のファイルへの流し書き・文書 (`docs/library.md`・`docs/cli.md`・CHANGELOG の日英) | コード 150 行・試験 150 行・文書 150 行 |
| P2-4 | `scripts/measure-memory.mjs` と測った値 (この覚え書きに書く)・`docs/development.md` (日英) | 道具 150 行・文書 50 行 |

合わせて、コード 500 行・試験 600 行・道具 150 行・文書 200 行ほど (0.6.0 の覚え書きの見積もりより小さいのは、書き方の写しを P1 に移したため)。1〜2 日。
3.5 の 2 つ目 (初めて使う所で埋め込む形) を選んだときは、もう 1 段 (コード 200 行・オブジェクトを中身で突き合わせる道具 200 行) と、全部の文書の確かめが増える。

## 4. どのコミットでも守ること

- 渡さないときの組版の結果と PDF は変えない (P1-1〜P2-4 のどれも)。`compare:base` で、全部の文書の PDF のバイト列が同じことを、P1-2・P2-2・P2-3 で確かめ、結果をコミットの文に書く。
- 組版の時間を変えない (`perf:compare`。P1-2・P2-2 で)。
- pdf-lib の中に手を入れる所は、`pdfLibPatches.ts` か `pdfWriter.ts` にだけ置き、前提 (使う部品・欄の名前) を読み込んだときに確かめる (いまの `assertPdfLibInternals` と同じ)。
  `pdfWriter.ts` が使う pdf-lib の部品 (`PDFHeader`・`PDFTrailer`・`PDFCrossRefStream`・`PDFObjectStream`・`PDFCrossRefSection`・`PDFTrailerDict`・`PDFInvalidObject`) は、どれも公開されている。

## 5. 利用者が決めること (推奨を最初に)

言葉: 「止める流れ」は、先に書けず最後まで持つ流れ (タグ付き PDF の、中に印を持つ Form と、pdf-lib に任せている α 付きの PNG) のこと。
「同じバイト列」は、ファイルの中身が 1 バイトも違わないこと。「同じオブジェクト」は、番号ごとのオブジェクトの中身は同じで、ファイルの中の並びと位置の数だけが違うこと。

1. **流した PDF と流さない PDF の同じさ** (タグ付き PDF の、SVG に字がある文書などで違いが出る)
   - (推奨) 止める流れが無い文書は同じバイト列、ある文書は同じオブジェクトとする。止める流れより大きい番号の流れも先に書く (メモリが下がる)
   - いつも同じバイト列にする。止める流れより大きい番号の流れは、先に書かずに持つ (その文書では、メモリがほとんど下がらない。タグ付き PDF は既定で付くので、SVG に字のある文書の多くが当たる)
   - いつも同じバイト列にし、流さないときも、流すときと同じ並び (止める流れを後ろに回す) で書く。流さない PDF が、止める流れのある文書で 1 度だけ変わる (オブジェクトは同じ)
2. **圧縮を pdf-lib の pako のままにするか** (オブジェクトの流れ・相互参照の流れ・`deflate` を渡さないときの流れ)
   - (推奨) 0.7.0 では pako のまま (PDF が前と同じバイト列。pako 1 は pdf-lib の中に残る)
   - 書き手が Kumiori の圧縮 (Node の zlib など) を使う。pako 1 への頼りが減るが、全部の文書の PDF のバイト列が 1 度変わる (中身は同じ)
3. **pdf-lib の版を止めるか** (P1 の書き手は、pdf-lib の部品の書き方と同じであることを前提にする)
   - (推奨) `package.json` の `^1.17.1` を `1.17.1` にする (新しい版は 2021 年から出ていないが、出たときに黙って変わらないように。上げるときは P1 の試験で確かめる)
   - `^1.17.1` のまま (P1 の試験が、版が変わったら落ちるので気付ける)
4. **流し書きの書き出し先の形**
   - (推奨) `WritableStream` と、塊を受ける関数の 2 つ。Node の `Writable` は `Writable.toWeb` で渡す (公開の型に Node の型を入れない)
   - Node の `Writable` も、じかに受ける (`write`・`drain`・`end` を見て見分ける。型に Node の型が入る)
5. **組版とのつなぎ (束 T0 との境目)**
   - (推奨) 0.7.0 では、いまの形 (先にたどってから描く) のまま。PDF は前と同じバイト列。T0 の側が、先のたどりのページを渡す (たどるための回を組む、か、描く回まで木を持つ)
   - 初めて使う所で埋め込む形にする (1 回のたどり。T0 の 1 回の流れとそのまま合う)。全部の文書の PDF が 1 度変わる (オブジェクトの中身は同じで、番号・並び・部分書体の印が変わる)。確かめの道具が要る
6. **PDF/X・PDF/A と流し書き**
   - (推奨) 使えない (何も書く前に `KumioriOptionError`)。コマンドは `--pdfx`・`--pdfa` のとき流さずに書く
   - 全体を作ってから書き出し先へ流す (使えるが、メモリは下がらない。info の診断で知らせる)
7. **コマンドの流し書き**
   - (推奨) 選択肢を足さずに、PDF (`--pdfx`・`--pdfa` のほか) はいつも流して書く。一時のファイルに書き、書き終えたら名前を替える
   - `--stream` を足し、付けたときだけ流す
   - コマンドは流さない (API だけ)
8. **上流の fontkit へ移る時期**
   - (推奨) 0.7.0 ではしない。書体の埋め込みを自前にするとき (0.8.0 以降) に一緒に移る。それまでに 3.0.x の直しの版と変更の記録を待つ
   - 0.7.0 に別の束として入れる (組版の結果が広く変わりうるので、確かめが大きい)
9. **0.8.0 以降に外す順** (1.5)
   - (推奨) 画像の埋め込み → 書体の埋め込みと fontkit の移り → フォームの欄。オブジェクトの形・描く命令・PDF を読む所は、困るまで pdf-lib のまま
   - 全部を外す (pdf-lib への頼りを無くす。5,000 行ほど。PDF を読む所の安全を自前で持つ)
   - pdf-lib を取り込んで (MIT)、中を直接直す (差し替えが要らなくなるが、2021 年の作りと pako 1 を持ち続ける)

## 6. 決めたこと (2026-11-23)

利用者が、5 の 9 つをすべて推奨の案で決めた。

1. 止める流れの無い文書は、流した PDF も流さない PDF と同じバイト列。止める流れのある文書は、同じオブジェクト (並びだけが違いうる)。
2. 圧縮は、0.7.0 では pdf-lib の pako のまま (画像の流れは、7 のとおり D-069 で改めた)。
3. pdf-lib の版は 1.17.1 に止める。
4. 書き出し先は、WritableStream と、塊を受ける関数 (Node は `Writable.toWeb` で渡す)。
5. 組版とのつなぎは、0.7.0 では先にたどってから描く形のまま (PDF は同じバイト列。組版の側が先のたどりのページを渡す)。
6. PDF/X・PDF/A では流せない (`KumioriOptionError`)。
7. コマンドは、いつも一時のファイルに流して書き、終わったら名前を替える。
8. 上流の fontkit への移りは、0.8.0 以降に書体の埋め込みと一緒に。
9. 0.8.0 以降に外す順は、画像の埋め込み → 書体の埋め込みと fontkit → フォームの欄。ほかは困るまで pdf-lib のまま。

## 7. 後で変えたこと (2026-11-23。PNG の埋め込みを速くする束 I1)

利用者の決め (D-069) で、6 の 2 (圧縮は pako のまま) を、画像の流れについて改めた。P1・P2 の作りに関わるのは、次のこと。

- 画像の流れは、埋め込むとき (`embedPngChecked`・`embedCmykImage`) に、もう圧縮の済んだ流れ (`PDFRawStream`。`context.stream` に圧縮したバイト列を渡す) にしてある。
  圧縮の関数は `src/imageDeflate.ts` の `imageDeflater` (選択肢の `deflate` → Node の zlib → `CompressionStream` → pako の順)。
  `PDFFlateStream` ではないので、`useDeflate` (差し替え 5) は画像の流れに当たらない。P1 の書き手が `deflate` を取り込むときも、画像の流れはそのまま書けばよい。
- pdf-lib に任せていた α 付きの PNG (16 ビット・色の表・tRNS・飛び越し) は、pdf-lib の展開 (`PngEmbedder.for`) で画素にするだけにして、
  `pdf.embedPng` (保存のときに埋め込む) は使わない。埋め込んですぐ番号と流れがそろうので、P2 の「止める流れ」から、pdf-lib に任せる α 付きの PNG が無くなる
  (残るのは、色つきの字形の JPEG (`pdf.embedJpg`。もともと先に埋め込める) と、タグ付き PDF の中に印を持つ Form)。
- 1.5 の表の (e) 画像の埋め込みの見積もりのうち、「pdf-lib に任せている PNG の形の展開と SMask」は、展開 (UPNG) だけが pdf-lib に残った。
- `design/pdf-writer.md` の 2.3 の比べ (`save` と自前の書き手が同じバイト列) は、画像の流れのバイト列が環境 (Node の zlib・ブラウザの `CompressionStream`) で違いうるので、
  同じ環境の中で比べる。

## 8. 束 P1 で作ったもの (2026-11-23)

`src/pdfWriter.ts` に、自前の書き手を作り、`pdfRenderer.ts` の `save` の 2 か所と `pdfImageEmbed.ts` の 1 か所を `writePdf` にした。
版の書き換え (先頭の 8 バイト) と `useDeflate` (差し替え 5) は消した。出る PDF は前と 1 バイトも違わない (2.3 の確かめ)。
設計で決めていなかったことは、次のように決めた (推奨の案で進めた)。

- **先に書く口 (`release`) は P1 に入れた。** 2.4 の表では P2-1 だったが、番号の順の切れ目まで書く数え方 (3.2) は書き手の中の数え方と分けられないので、
  P1 の `PdfWriter` に持たせた。`release(ref)` は、書いてよい流れを知らせ、番号の小さいほうから切れ目無く続く所までを、いま書いて `context.delete` で除く。
  待たせるのは、まだ書いてよいと知らされていない流れ・まだ中身の無い番号 (`nextRef` で取って後で入れるもの)・まとめないもの (暗号化の辞書・`PDFInvalidObject`) と、
  相互参照の表で書くときの流れでないもの全部。先に書いたバイト列は、P1 では `early` に持ち (書き出し先へ流すのは P2 の `drain`)、`finish` で 1 つの配列にまとめる。
  P2 は、この `early` を書き出し先へ渡す形 (`PdfStreamWriter`) を足せばよい。
  流れでないと見て進めた番号に、後で `assign` で流れが入ったときは、その流れだけが後ろに回る (保存の並びと違う。いまの Kumiori では起きない。P2 の試験で見張る)。
- **圧縮の関数を当てる所**: 書き手の前の手順の中で、`flush` の後、ページを足す・フォームの欄の見た目を作り直す前 (前の `useDeflate` と同じ所)。
  前は PDF/A の `addTrueTypeLength1` の前に当てていたが、それは書体のファイル (圧縮の済んだ流れ) の辞書に `Length1` を足すだけなので、順が入れ替わっても同じバイト列。
  先に書く流れには、書くときに同じ関数を当てる。
- **フォームの欄**: pdf-lib の `save` と同じく、`getForm` で作ったフォームの覚え (`formCache`。pdf-lib の中の欄) があれば `updateFieldAppearances` を呼ぶ。中の欄が無ければ `internal/patch-mismatch`。
- **save と比べる試験の口**: `PdfRenderOptions` の内の選択肢でなく、`pdfWriter.ts` の試験用の関数 `__setPdfWriterForTest` で `writePdf` を取り替える形にした
  (`pdfRenderer.ts` と `pdfImageEmbed.ts` の両方の書き出しが、選択肢を通さずに替わる)。試験 (`test/pdfWriter.test.ts`) が、前の書き方 (`save`・`useDeflate` の写し・版の書き換え) を持つ。
- **間をあける所**: pdf-lib の 50 個ごとの `waitForTick` を、止める合図か進み具合の呼び返しを渡した呼び出しのときだけ `pause` にした (渡さない呼び出しは間をあけない)。
- **数えた大きさと書いた大きさ**: 違えば `internal/patch-mismatch` (pdf-lib の部品の書き方が変わった)。
- **pdf-lib の版**: 6 の 3 のとおり、`package.json` を `1.17.1` に止めた。

## 9. 束 P2 で作ったもの (2026-11-23)

`typesetToPdfStream`・器の `typesetToPdfStream`・`TypesetResult.toPdfStream` と、コマンドの一時のファイルへの流し書きを作った。
書き手は P1 の `PdfWriter` に書き出し先 (3 つ目の引数 `PdfStreamTarget`) を足したもので、別のクラス (`PdfStreamWriter`) は作らなかった。
設計で決めていなかったこと・設計と変えたことは、次のように決めた (推奨の案で進めた)。

- **組版の側の口 (PageSink) は作らない。** 6 の 5 (先にたどってから描く形のまま) で、組版の側は、いまの `SheetSource` (収束した後のページを 1 枚ずつ作り、描いたら `release` で手放す) と
  `LowMemorySheets` のままで足りる。PDF の側の口は、いまの `PdfPageSource` の `paint` のまま (渡したページの描き手が `Promise` を返したら、待てる出どころは次のページの前に待つ)。
  `layoutEngine.ts` には触らない (束 T3 とぶつからない)。`design/resumable-flow.md` の 8 の口は、0.8.0 以降に「初めて使う所で埋め込む形」と一緒に作る。
- **先に書く流れは、一覧で知らせずに、ページの終わりに「いまある流れを全部」知らせる (`releaseAll`)。** 3.2 の案は、描き手が書き終えた所ごとに `release` を呼ぶ形だったが、
  流れを作る所が 20 か所ほどあり (Form XObject・模様・シェーディングの関数・色つきの字の手順・ICC など)、1 つでも漏れると、それより大きい番号の流れが全部最後まで待たされる。
  ページを描き終えた所では、描いたページまでの流れは、もう変わらない (後で辞書を書き足すのは、タグ付き PDF の中に印を持つ Form の `StructParents` だけ。`PdfTagger.markedForms` で除いて最後に書く)。
  まだ中身の無い番号 (書体の辞書・縦書きの書体・Type 3 の書体・注釈。どれも後で流れでないものが入る) は、最後に書くと決めて飛ばす (`defer`)。
  後で辞書を書き足す流れを見落とすと、先に書いたバイト列が流さない PDF と違うので、試験 (`test/pdfStream.test.ts` のバイトの比べ) と `compare:base` (コマンドは流して書く) が見つける。
  また、先に書いて除いた流れを後で引いたら投げる試験用の切り替え (`__setReleasedLookupCheckForTest`) で、流しの試験の全部の文書を通す。
- **画像は、埋め込むたびに書いて除く** (`embedImages` の `afterEmbed`)。JPEG は、`embedJpg` の後すぐ `embed()` を呼ぶ (`embedJpgNow`。新しい番号を取らないので、流さないときも同じ PDF)。
  pdf-lib の遅い埋め込みのまま残ると、その番号の流れが最後に回り、並びが変わるため。
- **止める流れの無い文書が同じバイト列になる理由**: ページの終わりごとに、それまでに作った流れを番号の順に書くので、ファイルの中の流れの並びは、保存のときの番号の順と同じ。
  最後に書くのは、流れでないもの (オブジェクトの流れにまとめる) と、最後に作る流れ (書体のファイル・ToUnicode・XMP・注釈とフォームの欄の見た目) で、どれも先に書いた流れより大きい番号。
  中に印を持つ Form がある文書は、その Form だけが後ろに回る (6 の 1 の「同じオブジェクト」。試験で、番号ごとの中身が同じことを確かめる)。
- **見出しは、最初の流れと一緒に書く。** 3.3 の「最初のページを描き終えてから」ではなく、最初の画像を埋め込んだ所で書くことがある。描く前に分かる誤りのうち、流して書くときに起きうるもの
  (`pdfua/requires-tagged`) は、画像を埋め込む前に確かめる (流さないときは、前と同じ所で同じ誤り)。`pdf/tagged-incompatible` は PDF/X-1a・X-3 だけなので、流すときには起きない。
- **文書の ID**: `DocumentIdStream` (`pdfStandard.ts`) が、先に書いたオブジェクトを 1 つずつハッシュに足し、最後の塊の印を書き換える。`finishDocumentId` と同じ ID
  (trailer の印はファイルの終わりの 2 つを使うので、先の塊に同じ字の並びがあっても同じ)。XMP の包みの中の印が先の塊にあれば誤り (書き換えられない)。
  足していく SHA-256 は、Node では crypto の `createHash`、ほかは自前 (`Sha256Js`。`sha256Js` もこの上に作り直した)。
- **書き出し先の口 (`src/pdfOutput.ts` の `PdfOutputPort`)**: 塊を順に渡し、待たせる書き出し先 (Promise・`WritableStream`) は、渡す順に繋いで、ページの終わりの `drain` で待つ。
  書き出し先の誤りは覚えておき、次に書くときに投げる (待たない出どころ (メモリ節約の組み直し) が、返した Promise を見なくても、誤りを見落とさない)。
  `WritableStream` は書くたびに `ready` と `write` を待つ (並ぶ塊は 1 つまで)。誤り・止める合図で終えたら `abort(理由)`、書き出し先の誤りなら `abort` せずにロックだけを放す。
- **最後の塊**: 最後に書く分 (書体のファイルなど) は、P1 と同じ数え方で 1 つの配列に作り、印を書き換えてから 64KB ずつ渡す。書体の多い文書では、ここが PDF の側のいちばん大きな配列になる。
- **コマンド**: 標準出力 (`-o -`) と、出力がシンボリックリンク (`-o /dev/stdout` も) か、ふつうのファイルでないものは、流さずに全体を作ってから書く (名前を替えると、リンクそのものや、
  開いたファイルの外の名前を置き換えるため)。前の出力の許可の印 (mode) は、一時のファイルに写してから名前を替える。出力が読むファイルでないかの確かめ (`checkOutputFiles`) は、名前を替える前にする。
- **作る段**: 3.9 の P2-1〜P2-3 は、書き手の試験 (P2-1) のほかは API を通して確かめるので、P2-1 (書き手・書き出し先の口・SHA-256・文書の ID) と、P2-2・P2-3 (描き手へのつなぎ・API・コマンド・文書) の 2 つのコミットにした。

### 9.1 測った値 (scripts/measure-memory.mjs。Node 22・4 CPU の機械)

PDF を書く間の生きている量は、PDF を書き始めた所と、書く間に 20 回ほど、片付けてから見た量の山。「外」は `arrayBuffers`。

| 文書 | ページ | PDF | 形 | ヒープの山 | PDF を書く間の生きているヒープ | 外の山 | PDF を書く間の外の山 (段 pdf) | RSS の山 | 時間 |
|---|---|---|---|---|---|---|---|---|---|
| 文だけ (11,200 節) | 1,600 | 2.2MB | 流さない / 流す | 1,132 / 1,109MB | 522 / 522MB | 78 / 77MB | 78 / 77MB | 1,455 / 1,450MB | 26.7 / 29.1 秒 |
| 同 (メモリ節約) | 1,600 | 2.2MB | 流さない / 流す | 1,082 / 1,085MB | 536 / 536MB | 78 / 77MB | 78 / 77MB | 1,598 / 1,912MB | 51.8 / 53.0 秒 |
| 画像 200 枚 | 200 | 196MB | 流さない / 流す | 68 / 66MB | 53 / 52MB | 793 / 780MB | 661 / 266MB | 1,176 / 961MB | 3.2 / 3.5 秒 |
| 同 (メモリ節約) | 200 | 196MB | 流さない / 流す | 70 / 69MB | 55 / 55MB | 942 / 793MB | 942 / 554MB | 1,186 / 996MB | 3.9 / 3.9 秒 |
| 対応仕様説明書 (HTML) | 147 | 1.7MB | 流さない / 流す | 398 / 559MB | 211 / 212MB | 198 / 200MB | — | 759 / 925MB | 30.6 / 29.5 秒 |
| 対応仕様説明書 (XSL-FO) | 100 | 1.1MB | 流さない / 流す | 419 / 457MB | 166 / 166MB | 176 / 175MB | — | 747 / 833MB | 15.0 / 14.5 秒 |
| CSS-Print | 142 | 4.4MB | 流さない / 流す | 626 / 370MB | 230 / 230MB | 199 / 195MB | — | 1,037 / 971MB | 21.1 / 20.6 秒 |

- 文の多い文書は、見込みどおり変わらない (生きているヒープが同じ)。ヒープの山・RSS の山の違いは、片付けの時機の揺れ (同じ形を 2 度測って、html-spec の流さない形で 414MB と 398MB、流す形で 581MB と 559MB)。
- 画像の多い文書は、PDF を書く間の外の山が 4 割ほどになる。全体の山 (約 780MB) は、組む前に画像を読み込む段 (resources・import) にあり、変わらない (道具が作った画像のバイト列 (196MB) を、道具が持ち続けることも入る)。
  画像を読み込む所の山は、画像の置き場 (`AssetStore`) が組む前に全部を読むことによる (3.4 の後の課題のまま)。
- 0.6.0 の覚え書きの「文だけの 1,600 ページで山 1,548MB」は、`typesetToPdf` の 20ms ごとの山。この測りでは 1,132MB (同じ道具ではないので、比べない)。

### 9.2 読み直し (4a) の後の直し (2026-11-23)

- 書き始める前の誤り (選択肢・PDF/X・PDF/A・前に止めた合図・書体の読み込み) でも、`WritableStream` を `abort(理由)` する (`pipeTo` の既定に合わせた)。
  書き出し先を確かめたら、すぐ口を作り (ロックする)、その後の誤りはどれも `streamTo` の中で受ける。書き出し先そのものの形の誤りでは触らない。
- `pdfx: null`・`pdfa: null` は、`typesetToPdf` と同じく無しとして通す。
- コマンド: 一時のファイルは最初に書く所で作り、書いている間だけ SIGINT・SIGTERM・SIGHUP の受け手を置く (一時のファイルを消してから、受け手を外して同じ合図で終わる)。
  同期で書き続けると受け手が動かないので、書き出し先の関数が 50ms ごとに `setImmediate` の Promise を返して間をあける (`--low-memory` では、待たせると塊がたまるので、間をあけない)。

## 10. 0.8.0 以降に送ったもの

`docs/BACKLOG.md` にも書いた。

- 画像・書体の埋め込みの置き換え (6 の 9 の順。画像の埋め込み → 書体の埋め込みと上流の fontkit (6 の 8) → フォームの欄)。
- 組版の側の口 (`design/resumable-flow.md` の 8。初めて使う所で埋め込む形) と、画像の置き場が組む前に全部を読む作りの見直し (9.1 の、画像の多い文書の山)。
- 文の多い文書のメモリの山 (9.1。山は組版の途中の木にあり、流しても変わらない)。組版の木を途中で手放す作りが要る。

### 9.3 読み直し (3B) の後の直し (2026-11-23。利用者の就寝中、おすすめで決めた (D-075))

- 読めなかったオブジェクト (`PDFInvalidObject`。PDF の画像の写しに入りうる) は、save でも流れと同じに番号の順にそのまま書くので、先に書く数え方でも、
  知らせを待たずに、いま書く (前は、そこで待って、後ろの流れが全部、最後まで先に書かれなかった)。`releaseAll` は、前になめた所の続きからなめる。
  先に書く 1 つのオブジェクトも、数えた大きさと書いた大きさを比べる。
- コマンド: 読み取り専用の前の出力は、名前を替えて置き換えずに、前のとおり直に書いて書けない誤りにする (おすすめの案。誤って上書きしないよう読み取り専用にした出力を黙って置き換えない)。
  合図を自分に送り直せない (Windows の SIGHUP) ときは、`process.exit(128 + 合図の番号)` で終わる。

### 9.4 合図で止めたときに一時のファイルが残る窓 (2026-11-23。利用者の就寝中、おすすめで決めた (D-075))

- 流せるかの確かめ (`streamTarget`) は、前の 1 度目の直しで、ファイルを作らず (ディレクトリの access の W_OK と名前の長さで) 見るようにしたが、
  ACL・短い NAME_MAX のファイルシステムなどで、作れるかと食い違った (API-69。読み直し 5)。いまは、実際に作って消し、その間も合図の受け手を置く
  (前は、作って消す間に受け手が無く、合図で終わると確かめのファイルが残った。全体の試験の重いときに 1 度だけ出た揺れは、試験がこのファイルを見つけて合図を送った形と合う)。
- 受け手は、書いている一時のファイルが無くなっても、次の回り (`setImmediate`) まで外さない (すぐ外すと、同期の処理の間に届いて、まだ受け手に渡っていない合図が落ち、合図で終わらなくなる)。
- 一時のファイルを作る前に、合図の受け手を置く (前は作った後に置いていて、その間に来た合図で残りえた)。

## 11. 画像の埋め込みを自前にした (2026-11-24。0.8.0)

利用者の決め (D-099) で、1.2 の (e) を 0.8.0 に入れた。ブラウザ・Web Worker で α 付きの PNG を PDF に入れる時間を縮める直し (OUT-111) と同じ束。

- 置き場: `src/imageEmbed.ts` (新しいファイル)。`pdfLibPatches.ts` の差し替え 3 (`PngEmbedder` の原型の上の部品 `streamEmbedder`・`embedNow`) と、
  PNG・JPEG の埋め込みの関数 (`embedPngChecked`・`embedPngAsIs`・`embedCmykImage`・`embedJpgNow`) を移し、pdf-lib の `embedJpg`・`embedPng`・`PngEmbedder`・
  `JpegEmbedder`・`PDFImage` を使わない形にした。埋め込んだ画像は `PdfImage` (`ref`・`width`・`height` だけ) で、描く側 (`pdfRenderer.ts`・`colorGlyphPdf.ts`) は
  `PDFImage` の代わりにこれを持つ。番号の取り方は pdf-lib と同じ (画像の番号を先に取り、SMask は後)。辞書の鍵と並びも同じ。
- JPEG (`embedJpeg`): SOF (ITU-T T.81 §B.2.2) から幅・高さ・精度・成分の数を読み、ファイルをそのまま DCTDecode の流れにする。辞書は pdf-lib の `JpegEmbedder` と同じ
  (CMYK は Decode [1 0 1 0 1 0 1 0])。pdf-lib との違いは、印の読み方を規格に合わせたこと: 詰め物の 0xFF・長さの無い印 (TEM・RST) を飛ばす、DAC (0xFFCC) を SOF と
  取り違えない、バイト列の途中を指す JPEG (`subarray`) を初めから読む (pdf-lib は `imageData.buffer` の頭から読んでいた)。
- PNG の展開 (`pixels.ts` の `decodePngForPdf`。非同期にした): どの形 (色の型 0・2・3・4・6、深さ 1〜16、tRNS、Adam7 の飛び越し) も自前で 8 ビットの RGB と α にする。
  値は pdf-lib の展開 (UPNG の `toRGBA8` と `embedPng` の分け方) と同じ (16 ビットは上位の 8 ビット、色の表に無い番号は黒、α が全部 255 なら α は無し)。
  UPNG の誤りは引き継がない: 1・2・4 ビットの飛び越しの PNG の走査線の大きさを少なく見積もって終わりの画素を落とす (画像の大きさによる)、
  2 つ目からのパスの最初の行の平均のフィルタを違う位置に当てる、16 ビットの灰の tRNS を違う位置の 2 バイトと比べる。これらに当たる PNG を含む文書は、絵が仕様どおりに変わる。
  動く PNG は、コマが 2 つ以上なら断り (pdf-lib も断っていた)、1 つなら IDAT の画像を入れる。壊れた画素のデータは、前と同じく「PNG: 画素のデータが壊れています」。
  UPNG の止まらない展開を避けるための前の確かめ (`pngDataComplete`) は要らなくなったので消した。
- 展開 (`imageDeflate.ts` の `inflateZlib`): Node は zlib (前と同じ)、Node でなく `DecompressionStream` があれば (ブラウザ・Web Worker) それ (出たバイト数が
  走査線の大きさに届いたら読むのを止める)、どちらも断ったら自前の展開 (`inflateFast`。壊れた所まで)。展開せずに入れる PNG の確かめ (`idatComplete`) も同じ関数にした。
- フィルタを戻す・RGB と α に分けるのは、行ごとに 1 度の走査にした。8 ビットの RGBA (画面の写しの形) は、行を 4 バイト境界の作業の行に写し、
  Sub・Up・Average を 1 画素 (32 ビットの数) ずつまとめて戻す (バイトをまたぐ桁の上がりを出さない足し算と平均)。
- 画素の圧縮 (`imageDeflater` の `CompressionStream` の道): Blob と Response を通さずに、書き手に 1 度に書き、読み手で集める (同じバイト列。1.5 倍ほど速い)。
- pdf-lib に残る画像まわり: なし (`PDFHexString` などのオブジェクトの形 (a) は使う)。`@pdf-lib/upng` は pdf-lib の依存として入るが、Kumiori は呼ばない。

### 11.1 測った値 (scripts/measure-png-embed.mjs。4 CPU の機械)

197 ページ・1600×1000 の 8 ビット RGBA の PNG 333 枚 (計 55MB) の試しの文書を、利用者と同じ流れ (`createTypesetter` → `typeset` → `toPdf({ title, date, onProgress })`) で組んだ。
秒。(a)〜(c) は画像ごとの処理を足した時間、(d) は toPdf から (a)〜(c) を引いたもの。

| 所 | | (a) 展開 | (b) フィルタを戻す・α を分ける | (c) 画素の圧縮 | (d) そのほか | toPdf | 最初の onProgress まで | 全体 |
|---|---|---|---|---|---|---|---|---|
| Worker (Chromium) | 前 | 12.14 | 7.84 | 17.56 | −1.22 | 36.33 | 40.01 | 41.05 |
| Worker (Chromium) | 後 | 3.46 | 5.69 | 10.28 | 0.96 | 20.39 | 24.89 | 25.71 |
| Node | 前 | 2.30 | 6.12 | 11.62 | 1.88 | 21.92 | 22.49 | 22.97 |
| Node | 後 | 1.82 | 4.64 | 11.28 | 0.98 | 18.72 | 19.61 | 20.15 |

(d) は、別に測った (a)〜(c) を toPdf から引いた見積もりなので、揺れて負にもなる (前の Worker)。組版 (typeset) は Node 1.0〜1.4 秒・Worker 4.7〜5.3 秒で、変わらない。
PDF は、前と後、Node と Worker のどれも同じバイト列 (同じ SHA-1)。リポジトリの文書と手元の見本の 270 文書 (`npm run compare:base`) も、どれも前と同じバイト列。

残った時間の大半は、(c) の画素の圧縮 (Worker の `CompressionStream`、Node の zlib。どちらも圧縮の強さ 6 で、Node と Worker で同じバイト列を出す)。
強さを下げる・画像ごとに別の Worker で圧縮するのは、PDF のバイト列が変わるか、Kumiori の外の作り (Worker の数) に関わるので、しない。
速さの要る利用者は、`toPdf` の `deflate` に速い圧縮の関数を渡せる (画像の画素にも使う)。

## 12. 文の多い文書のメモリの山を下げる (BACKLOG の P-01。設計の覚え書き 2026-11-24)

### 12.1 測って分かったこと (文だけの 1,600 ページ。`scripts/measure-memory.mjs --doc text:11200 --mode stream`。このコンテナ、Node 22)

- いま: ヒープの山 982MB・PDF を書く間の生きているヒープ 524MB・RSS の山 1,297MB・33.2 秒。
- 組み終えた所 (`endSheets` の初め) で片付けた後のヒープは 520MB。全部のページの組版の途中の木 (`PageBuild` の `root`・`abs`) を手放すと 107MB。
  **山の 410MB (8 割) は、全ページの組版の途中の木**で、残り (入力の木・スタイル・フォント・行分けのキャッシュ) は 107MB。
- 同じ全ページを領域の木 (`SheetArea`) にして持つと 548MB (組版の途中の木より大きい)。JSON にすると 786MB。
  中間の形にして持つのでは下がらない。下げるには、**確定したページを、組んでいる間に PDF の命令 (圧縮した中身の流れ。この文書で全部で 2.2MB) にして、木を手放す**しかない。

### 12.2 いまの作りで、組みながら手放せない理由

- PDF の側 (`renderPdfPages`) は、先に全部のページをたどって (scan) 使うフォント・画像・色つきの文字を集め、`fonts.all()` の順でフォントを埋め込み、画像を埋め込んでから、
  ページを描画する (paint)。フォントの資源の名前・部分フォントの印 (`subsetTag(埋め込んだ順)`)・オブジェクトの番号 (フォントと画像が先、ページの流れが後) は、全部のページを見てから決まる。
  そのため、ページを描画するには全部のページが組み終わっている必要があり、組み終えるまで全部の木を持つ (いまの 520MB)。
- フォント・画像の番号を後で決める (取っておく) こともできない (いくつ要るかが、組み終えるまで分からない)。
  **組みながら描画すると、PDF のバイト列 (オブジェクトの番号と並び・部分フォントの印・資源の名前) は、どうしても変わる** (ページの中身の命令・見た目は同じ)。
  (12.4 では、画像・色つきの文字の無い文書だけを組みながら描画し、そうした文書は、どの書き出しでもフォントを初めて使うページの前で埋め込む形にして、
  変わる文書を、2 ページ目から後で初めて使うフォントのある文書に減らした)
- 画像の埋め込み (展開・圧縮) と色つきの文字の用意は非同期で、組版は 1 つの page-sequence の中では同期 (Flow の再帰の中) なので、
  画像・色つきの文字の要るページは、組版が待てる所 (page-sequence の境目・組み終わり) まで描画できない。フォントの埋め込みは同期にできる (fontkit は同期)。

### 12.3 案 (利用者の決めを取りまとめ役に尋ねた。推奨を最初に)

1. (推奨。これで作った。下の 12.4) PDF の書き出しを「初めて使う所で埋め込む」形にし、組みながら確定したページを描画して手放す。
2. 流し書き (`typesetToPdfStream`・コマンド) だけ「初めて使う所で埋め込む」(流した PDF と流さない PDF のバイト列が違うようになる)。
3. PDF のバイト列を変えない: メモリ節約 (`lowMemory`) の組版で、page-sequence の中でもページごとに手放す (2 回組むので、時間は約 2 倍)。

利用者が 1 を選んだ (D-106。問 2 の Typesetter の扱いは、前の文書の組版のキャッシュがあるときは再利用して手放さない、無いときは手放す)。1 は、尋ねた後で、バイト列の変わる文書がずっと少ない形に詰め (12.4 の「PDF の側」)、取りまとめ役が 1 の範囲の中として承った。

### 12.4 作ったもの

**組版の側** (`layoutEngine.ts` の `PageEmitter`・`emitPages`・`emitOne`):

- `layoutSheets`・`layoutSheetsPaced` に渡す先 (`PageEmitter`。内部の口で、公開の API には出さない) を渡すと、1 段の page-sequence で次のページを作った所 (`mkPage`) で、
  前のページを確定したページとして、柱を組んで領域の木にして渡し、受けたら組版の途中の木を手放す (`releasePage`。マーカー・番号・マスターは残す。後ろのページの柱が引く)。
  page-sequence を組み終えたら、残りのページを渡す。`SheetSource.emitted` が渡したページの数で、`sheet`・`release` は、その後ろのページだけを作る。
- 渡せるのは、組み直しの 1 回目で、そのページまでの本文が、まだ置いていない参照先 (前向きのページ番号の参照・page-number-citation-last・物理的なページ番号・総ページ数) を
  引いていないとき (`host.cite` が、引いたページを `unsafeAt` にする)。柱を組む間に、まだ置いていない参照先か総ページ数を引いたら、そのページを渡さない。
  ページごとの脚注番号・段組・最後のページのマスター (last・only・rest) の page-sequence に来たら、そこから後ろは渡さない (ページの順を保つ)。
  索引・先頭から N ページで止める組版・組み直しの確認 (resumeCheck・遅く戻る試し) の文書と、前の文書の組版を再利用できるとき (Typesetter が `typeset` でキャッシュした文書) は、渡さない。
- 組み直しの 2 回目からの回は、1 回目に渡したページを組み直したもの (同じ値で組むので同じページ) を、渡さずに手放す。回の終わりの柱は、渡したページを飛ばし
  (渡すときに組んだ柱の警告を、柱の警告の初めに足す)、行番号の数えは、渡した最後のページの後から続ける (1 回目に、柱を組んでから断ったページがあれば、その後から)。
- 確認の切り替え (`emitProbe.keep`): 渡したページの組版の途中の木を手放さずに持ち、組み終えた所で、渡したときの領域の木と、組み終えたページから作り直した領域の木を、
  JSON で比べる (`test/pdfEmit.test.ts`。違えば、確定の決まりに漏れがある)。

**PDF の側** (`pdfRenderer.ts` の `PdfPageSource.layout`・`pageFonts`・`embedFontSync`):

- 画像 (背景の画像を含む)・色つきの文字の無い文書 (先のたどりで見つからない文書) は、フォントを、初めて使うページを描画する前に埋め込む
  (同じページで初めて使うフォントどうしは `fonts.all()` の順)。組みながら描画するかどうかに関わらず、どの書き出し (`typesetToPdf`・`typesetToPdfStream`・
  Typesetter の版・`toPdf`・`toPdfStream`・メモリ節約) でも同じにするので、`typesetToPdf` と `typeset` の後の `toPdf` と流し書きのバイト列は、いまのまま同じ。
  それ以外の文書 (画像・色つきの文字のある文書) は、いまのまま、描画する前に使うフォントを全部埋め込む。
- バイト列が変わるのは、画像・色つきの文字の無い文書のうち、2 ページ目から後で初めて使うフォントのある文書だけ (フォントの番号と部分フォントの印の並び。ページの中身・見た目は同じ)。
- 出どころが `layout` を持つと、先のたどりの前に、ページを描画する関数を渡して呼ぶ (出どころは組みながら確定したページを渡す)。描画する関数は同期で
  (組版は 1 つの page-sequence の中では待てない)、フォントの埋め込みも同期で作る (`embedFontSync`。pdf-lib の `embedFont` と同じ物・同じ番号の取り方)。
  画像・色つきの文字のあるページは断る (画像の埋め込みは非同期)。カラーフォントのある文書・PDF/X・PDF/A では、組みながら描画しない
  (`layout` を、描画する関数を渡さずに呼ぶ)。組み終えたら、残りのページを、いまのとおり先にたどってから描画する。
- 流し書きでは、描画したページの流れを、描画し終えた所で書き出し先へ書く (いまと同じ)。組版の間は書き出し先を待てないので、待たせる書き出し先 (`Promise`・`WritableStream`) では、
  圧縮した塊をためる (メモリ節約の組み直しと同じ)。組みながら描画する間は、PDF の進み具合を知らせず、組み終えた所で、描画したページの数を 1 度知らせる。

**API の側** (`api.ts`): `typesetToPdf`・`typesetToPdfStream` (関数と Typesetter の版) は、画像の格納先が空で、文書に背景の画像 (url の画像・グラデーション) が無く、
OS のフォント (`systemFonts`) を使わない文書で、組みながら描画する (画像のあるページが後ろにあると、そのページから後ろを組み終えてから描画することになり、
フォントと画像の番号の並びが、組み終えてから描画するとき (`toPdf`) と変わるため。OS のフォントは、組版の途中でカラーフォントを読みうるため)。
構造の木は、組む前に、入力の節の並びから作る。`TypesetResult.toPdfStream` は、組んだ結果が全部の領域の木を持つので、メモリは変わらない。


### 12.5 測った値 (`scripts/measure-memory.mjs`。このコンテナ、Node 22・4 CPU)

前は 875f85a (束 D の後)、後はこの変更。「組版の間の生きているヒープ」は、組み直しの回の 100 ページごとに片付けてから見た量の山 (この変更で道具に足した)。
「PDF を書く間」は 9.1 と同じ。時間は、組み始めから PDF を書き終えるまで (片付けの時間を含む)。

| 文書 | 形 | 組版の間の生きているヒープ | PDF を書く間の生きているヒープ | ヒープの山 | RSS の山 | 時間 |
|---|---|---|---|---|---|---|
| 文だけ (1,600 ページ・PDF 2.2MB) | `typesetToPdf` | 525 → 127MB | 523 → 121MB | 627 → 373MB | 1,054 → 564MB | 37.4 → 30.2 秒 |
| 同 | 流し書き | 525 → 126MB | 523 → 121MB | 617 → 358MB | 1,043 → 555MB | 37.5 → 28.1 秒 |
| 対応仕様説明書 (HTML。147 ページ。画像があるので組みながら描画しない) | `typesetToPdf` | 184 → 184MB | 209 → 211MB | 342 → 433MB | 735 → 796MB | 28.5 → 25.2 秒 |
| 同 | 流し書き | 184 → 184MB | 211 → 209MB | 352 → 331MB | 757 → 732MB | 27.5 → 26.6 秒 |
| 画像 200 枚 (PDF 196MB。組みながら描画しない) | `typesetToPdf` | 49 → 49MB | 53 → 53MB | 68 → 68MB | 1,155 → 1,160MB | 3.8 → 3.5 秒 |
| 同 | 流し書き | 49 → 49MB | 53 → 53MB | 68 → 67MB | 975 → 966MB | 3.7 → 3.8 秒 |

- 文だけの文書は、全部のページを組みながら描画し、生きているヒープは、ページの木の無い 107MB (12.1) に近くなった。時間が短くなったのは、組みながら描画したページの
  領域の木を 1 度だけ作るため (前は、先のたどりと描画で 2 度作っていた)。
- 対応仕様説明書と画像の多い文書は、組みながら描画しないので、生きている量は変わらない (ヒープの山・RSS の山・時間の違いは、片付けの時機と機械の揺れ)。
  画像のある文書の山を下げるのは P-05 (画像の格納先が組む前に全部を読む作りの見直し) と一緒に、画像を初めて使う所で埋め込む形を作るとき。
- `npm run perf:compare -- --base 875f85a --head .` (組版の `typeset` の CPU の時間。5 組) は、遅い文書なし (比 html-spec 0.961・fo-spec 1.019・gen:table 1.076・gen:rules 0.881・gen:para 0.985・gen:fonest 0.957)。
- `npm run compare:base -- --base 875f85a --head .` (270 文書。ah・css-print は既定のフォント) は、変わった文書 0・バイトも同じ 257・見た目は同じでバイトの違う文書 13
  (アンテナハウスのサンプル 12 と WeasyPrint の book-classical。2 ページ目から後で初めて使うフォントの番号と部分フォントの印が、後ろに回った。`test/intended-changes.json` に足した)。
  13 文書は、どのページも `pdftoppm -r 150` の画素が前とまったく同じ (前と後の PPM のバイト列を比べた)。

### 12.6 残したもの

- 画像・色つきの文字のある文書を組みながら描画すること。画像・色つきの文字の埋め込み (展開・圧縮) は非同期で、組版は 1 つの page-sequence の中では待てないので、
  いまは、そうした文書のメモリは下がらない (12.5 の対応仕様説明書・画像 200 枚の文書)。下げるには、画像を組む前に非同期で用意しておき (展開・圧縮。画像の格納先が
  組む前に全部を読むいまの作りに乗る)、組版の中では番号を取って書くだけにする形 (コード 300 行・試し 200 行ほど。用意した画像の圧縮したデータを書くまで持つので、
  画像の多い文書の山 (約 780MB) は、それだけでは下がらない) と、P-05 の、画像を初めて使う所で読み、埋め込んだら手放す作りを合わせる (合わせて 2〜3 日の見込み)。
- 前向きの参照 (目次など) のある文書の、参照のあるページから後ろ。組み直しの 2 回目からの回で、値の決まったページから渡す作りが要る (resumable-flow の 8.1 の (a))。
- 段組・最後のページのマスターの page-sequence (組み終えるまでページが決まらない)。
- Typesetter が前の文書の組版を再利用するとき (再利用するページは前の文書の木。再利用した後のページを渡す決まりが要る)。

## 13. 画像と色つきの文字のある文書のメモリ (束 E2。BACKLOG の P-01 の残りと P-05。設計の覚え書き 2026-11-25)

### 13.1 測って分かったこと (画像 200 枚の文書。`scripts/measure-memory.mjs --doc images`。前は 3fe6117)

- 外のバイト列の山は、読み込み (resources) の所で 787MB。うち 533MB は測る側が組む前から持つもの (渡した画像のファイル 216MB と、既定のフォントなど)。
  Kumiori が足すのは 254MB で、その大半は、画像の格納先 (`AssetStore`) が、渡されたファイルの中身を写して持つ分 (216MB)。
  画像のピクセルは、Node では持たない (PNG は、展開せずにそのまま入れるか、埋め込むときに 1 枚ずつ展開する)。
- ブラウザー (画面・Web Worker) では、読み込みのときに、どの画像も `createImageBitmap` (SVG は `<img>`) で画素にして、結果ごとに持つ。
  使う側の測りでは、197 ページの本の結果の見積もり 328MB の大半が、この画素。

### 13.2 案 (取りまとめ役に尋ねた。推奨を最初に。利用者が 3 つとも推奨 (A) を選んだ: D-111)

**PDF の側**

- (a) 画像を「用意」と「埋め込み」に分ける。用意 (非同期) は、PDF のオブジェクトを作らずに、画像の流れの中身を作る (PNG は、そのまま入れる形かを確かめるか、
  展開して RGB と α を圧縮する。JPEG は頭を読む。SVG は、図形にして、中の画像を用意し、`@font-face`・foreignObject を読む)。
  埋め込み (同期) は、用意したものを、番号を取って PDF に入れるだけ。
- (b) 埋め込みは、どの書き出しでも、画像を初めて使うページを描画する直前にする (フォントも、初めて使うページの前。12.4 の文だけの文書と同じ決まりを、
  画像のある文書に広げる)。組みながら描画するときは、組む前に用意しておく。組みながら描画しないとき (`typeset` の後の `toPdf` など) は、描画の前に用意する。
  番号の並びは、ページの順だけで決まるので、組みながら描画しても、しなくても、同じバイト列になる。組版の途中で増える画像 (背景のグラデーションを SVG にしたもの)
  は、同期で用意できるので、そのページで用意して埋め込む。
- (c) 画像のある文書の PDF は、どれもバイト列が 1 度変わる (オブジェクトの番号の並び。フォントと画像が、文書の初めでなく、初めて使うページの前に回る。見た目は同じ)。
- (d) 用意できない画像 (置く大きさで中身が変わるもの: `imageMaxDpi` で縮める JPEG、ブラウザーで PNG に直す GIF・BMP・WebP・TIFF、filter を画素で計算する SVG、
  `systemLanguage` のある SVG、PDF の画像 (ページを写すので、作るのが重い)) が 1 つでもある文書と、PDF/X・PDF/A は、いまのまま
  (組み終えてから、先に全部を埋め込む)。どの書き出しでも同じ決まりにする (画像の格納先にある画像で決める)。
- (e) P-05: 画像の格納先は、値で渡された中身 (`files` の `Uint8Array`・`ArrayBuffer`、`resolveResource` の返したもの) を写さずに、そのまま持つ (呼ぶ側も持っているので、
  Kumiori の分は 0 になる。結果の `memoryUsage()` の `images` にも数えない)。PDF だけを作るとき (`typesetToPdf`・`typesetToPdfStream`) は、用意し終えた画像の中身を、
  画像の格納先から手放す (いまは全部を埋め込み終えてから)。関数で渡されたファイルは、いまのとおり 1 度だけ読む
  (組版には画像の大きさが要るので、組む前に読む。読み直して 2 度読むことはしない)。
  - 別の案: 関数で渡されたファイルは、大きさを読んだら手放し、埋め込むときに読み直す (呼ぶ側が持たない形で渡せば Kumiori の分は 0 になるが、読みが 2 度になる)。
- (f) 色つきの文字 (カラーフォント): いまは、先に文書の全部をたどって、使う字形の画像 (CBDT・sbix・SVG の中の画像) を埋め込む。
  案: 色つきの文字の描き手を、文書の初めに作り (番号を取らない。初めて描く字で取る)、字形の画像は、初めて描く所で同期で埋め込む
  (そのまま入れられない PNG の圧縮は、同期の圧縮 (`deflate` の指定、無ければ pako) にする。Node と Worker で同じバイト列)。
  カラーフォントを使う文書の PDF のバイト列も 1 度変わる (字形の画像の圧縮の結果も変わることがある。見た目は同じ)。

**描画の側** (D-109・API-74)

- (g) `renderPage` を `Promise<void>` にする (推奨)。描画する前に、そのページの画像を、Typesetter 全体の画像のキャッシュから引き、無ければデコードして入れ
  (非同期)、そろってから同期で 1 度に描画する (Canvas が途中まで描かれた形で見えない)。読み込みのときには画素を作らず、大きさは画像の頭から読む。
  - 別の案: `renderPage` は同期のまま、読み込みのときに画素を作り (いまのとおり)、そのキャッシュを Typesetter 全体で 1 つにして中身ごとに分け合うだけにする
    (上限で捨てた画像は、描けなくなる (同期では作り直せない) ので、上限を置けない)。
- (h) キャッシュは Typesetter 全体で 1 つ (鍵は画像の中身)。上限は `createTypesetter({ imageCache: { maxBytes } })` (既定 256MB)。
  捨てる順は、使っている結果 (dispose していない結果) が無くなった画像を先に、残りは LRU。描画の途中の画像は捨てない (閉じた `ImageBitmap` を引かない)。
  Typesetter を使わない `typeset` の結果は、結果ごとのキャッシュ (同じ既定の上限) を持ち、`dispose` で手放す。
- (i) `Typesetter.memoryUsage()` の `caches` に数え、内訳の欄 `cacheDetail: { images, lines, pages, fontPrep }` を足す。`releaseCaches(kinds?)` の `kinds` は
  `{ images?, lines?, pages?, fontPrep? }` (引数なしは全部)。結果の `memoryUsage().images` からは、このキャッシュの分を外す。

### 13.3 作ったもの

**PDF の側** (`imageEmbed.ts`・`pdfRenderer.ts` の `lazyImages`・`colorGlyphPdf.ts`・`api.ts`):

- `imageEmbed.ts`: 埋め込みを、用意 (`preparePng`・`prepareJpeg`。PNG の確かめ・展開・圧縮をここでする。PDF のオブジェクトを作らない) と、
  埋め込み (`embedPrepared`。番号を取って流れを入れるだけ。同期) に分けた。`embedPngChecked`・`embedJpeg` は、この 2 つをつないだもの (番号の取り方は前と同じ)。
  そのまま入れる PNG の IDAT は、埋め込むときにつなぐ (用意した画像が、元のファイルの写しを持たない。中身は元のファイルの部分の配列)。
- `lazyImages`: 画像の格納先の画像を全部用意する (`prepareAll`。SVG を先に: 中の画像のファイルの中身を読むため)。ページを描画する直前に、そのページで初めて使う画像
  (画像の領域と背景の画像。`imageScanner` と同じ順) を埋め込み (`commit`)、埋め込んだ SVG の中の文字のフォントを埋め込む。同じ中身の画像は 1 つの XObject (embedImages と同じ)。
  使ったことの数え (`AssetStore` の `onUse`。コマンドの、使った画像の一覧) は、用意では数えず (`AssetStore.peek`)、埋め込むときに数える。
  組版の途中で足す背景のグラデーションの SVG (`@font-face`・foreignObject・中の画像の無いもの) は、待たずに用意する。
  - 用意できない画像 (`ok` が false): PDF の画像、`imageMaxDpi` の JPEG、ブラウザーで PNG に直してから入れる画像 (PNG・JPEG でないラスター画像と、埋め込めない PNG・JPEG)、
    `systemLanguage` のある SVG、filter を画素で計算する SVG (近似しても画素の計算の要る SVG)。
- `renderPdfPages`: PDF/X・PDF/A でなければ、まず `prepareAll` し、用意できない画像が無ければ、どの書き出しでも、フォントと画像を初めて使うページの直前で埋め込む。
  組みながら描画するときは、画像の用意できていないページ (組版の途中で足した、待たずに用意できない画像のあるページ) を断る (そのページから後ろは、組み終えてから用意して描画する)。
- 色つきの文字: 描き手 (`PdfColorGlyphs`) を、色つきの字を初めて描くページの直前で作り (`PdfColorGlyphs.lazy`。Type 3 書体の資源の番号を、そこで取る)、
  字形の画像は、先のたどりで集めて用意し (`imageCollector`・`prepareGlyphImages`)、初めて描く所で埋め込む (圧縮は前と同じ関数なので、字形の画像の中身は前と同じ)。
  組みながら描画するときは、組む前には使う字形が分からないので、画像のある色つきの字形 (CBDT・sbix・SVG の中の画像) のページを断る (COLR の字形・SVG の図形の字形は描画する)。
- `api.ts`: 組みながら描画するかを `renderPdfPages` が決めるので、`typesetToPdf`・`typesetToPdfStream` は、OS のフォントを使う文書のほかは、どれも渡す
  (前は画像・背景の画像のある文書を渡さなかった)。
- P-05: 画像の格納先は、渡された中身 (`files`・`resolveResource`) を写さずに持つ (`AssetStore.addBytes`)。PDF だけを作るとき (`releaseImageBytes`) は、用意し終えたラスター画像の中身を、
  格納先から手放す (呼ぶ側が持つ中身は、呼ぶ側が持ち続ける)。関数で渡されたファイルは、いまのとおり 1 度だけ読む (読み直さない)。

**描画の側** (`imageCache.ts`・`assets.ts`・`canvasRenderer.ts`・`api.ts`):

- `AssetStore` の `deferDecode` (api.ts の組んだ結果だけ。画面 (`main.ts`) は今のまま): ブラウザーの PNG・JPEG・GIF・WebP・BMP は、読み込みのときに 1 度デコードして
  読めるかと大きさ (EXIF の向きを当てた大きさ) を確かめ、すぐ閉じる (`ImageAsset.deferred`)。読めない画像の扱いと大きさは、前と同じ (頭から読むだけにすると、壊れた画像の知らせが出なくなり、
  EXIF の向きの読み違えで大きさが変わりうる)。読み込みのデコードの時間は前と同じで、描画するときに、もう 1 度デコードする。
- `ImageCache`: 鍵は画像の中身 (長さ・FNV-1a の 2 つの散らし値・種類)。`lease(持ち主, 画像)` で、そろえてから返し、`done` まで捨てない。上限を超えたら、持ち主の無い画像を古いものから、
  次に残りを古いものから捨てて `close()` する。`release(持ち主)` は持ち主を外すだけ (閉じない)。`clear()` は、引いていない画像を全部捨てる。
- `renderPage` は `Promise<void>`。`deferredImagesOf` (ページの画像の領域・背景の画像・SVG の中の外の画像のファイル) をキャッシュから引き、そろってから `renderSheetToCanvas` で
  同期で描画する (`CanvasRenderOptions.deferredImage`)。SVG の中の画像は、キャッシュの画像から読んだ画素を覚えない (キャッシュの画像は後で閉じることがある)。
- キャッシュは `createTypesetter` が 1 つ作る (`TypesetterOptions.imageCache.maxBytes`。既定 256MB)。関数の `typeset` などは、結果ごとに作り (`buildTypesetter` の privateImages)、
  `dispose` で全部捨てる。`Typesetter.memoryUsage()` に `cacheDetail` (`images`・`lines`・`pages`・`fontPrep`)、`releaseCaches(kinds?)` (`SharedLineMemo` の `clearLines`・`clearPages`)。

### 13.4 測った値

`scripts/measure-memory.mjs` (Node 22.23.5・4 CPU) と `scripts/measure-render-memory.mjs` (Chromium 158 の Web Worker) の前 (3fe6117) と後の値は、`docs/development.md` の
「メモリの山の測り」と「描画のメモリと時間の測り」の表にある。要点:

- 画像の多い文書 (PNG 200 枚): 外のバイト列の山 787 → 565MB、RSS の山 1,170 → 925MB (ストリームは 962 → 744MB)、時間 3.7 → 2.4 秒。下がったのは、主に画像をコピーしなくなったため。
- 画像の多い本 (197 ページ・α 付きの PNG 333 枚): `typesetToPdf` の RSS の山 537 → 485MB、時間 21.5 → 18.9 秒。ストリームでは、組む前に用意した画像を持つので、外のバイト列の山が 188 → 221MB に上がる
  (組版の途中の木は 56MB ほどで、もともと小さい)。
- 対応仕様説明書 (HTML): 先頭の目次 (前向きのページ番号の参照) で、2 ページ目から後ろは組み終えてから描画するので、変わらない (12.6 の残り)。
- 描画 (結果 2 件・全部のページ): Chromium の RSS の山 5,634 → 1,598MB (上限 64MB で 1,475MB)。全部のページの描画は 1.2 → 7.1 秒 (上限に収まらない画像をデコードし直す)。
- `npm run compare:base -- --base 3fe6117 --head .` (270 文書): 変わった文書 0・見た目は同じでバイトの違う文書 17 (対応仕様説明書 4・アンテナハウスのサンプル 9・examples の draw.io の図・
  『CSSページ組版入門』・WeasyPrint の book と report)。17 文書は、どのページも `pdftoppm -r 150` の画素が前とまったく同じ (前と後の PPM のバイト列を比べた)。`test/intended-changes.json` に足した。
- `npm run perf:compare -- --base 3fe6117 --head .` (組版の `typeset` の CPU の時間。5 組): 遅い文書なし (比 html-spec 0.960・fo-spec 0.970・gen:table 1.031・gen:rules 0.979・gen:para 0.884・gen:fonest 0.982)。

### 13.5 残したもの

- 組む前に用意した画像を、初めて使うページまで持つこと (13.4 の本のストリーム)。組版は page-sequence の中で待てないので、用意を組版と並べて進めるには、組版の途中で待てる所が要る。
- 置く大きさで中身が変わる画像・PDF の画像のある文書 (13.3 の `ok` が false の文書)。PDF の画像は、ページを写す所 (`pdfImageEmbed.ts`) を、用意と埋め込みに分ければ入れられる。
- ビットマップの色つきの字形のある字のページから後ろ (組み終えるまで、使う字形が分からない)。
- 前向きの参照のある文書の、参照のあるページから後ろ (12.6 のまま)。
