> English: [en/area-tree.md](en/area-tree.md)

# Area Tree (組版の結果) の形

`LayoutEngine.layout()` が返す `AreaTree` の決まりを、ここにまとめます。型は `src/types.ts`、たどる関数は `src/areaTree.ts` にあります。

## 版

- `AreaTree.schemaVersion` は形の版です。今は `2` で、値は `AREA_TREE_SCHEMA_VERSION` (`src/areaTree.ts`) から入ります。
- 欄の意味や子の持ち方を変えたら、版を上げます。
  - 1: 最初の版。
  - 2: 表の罫線の重ね合わせの描き方 (`paintWidth`・`noPaint`・`tableEdge`) を、`BorderSide` の欄から `BorderSide.collapse` の下に移しました。
- `parseAreaTree` は版 1 の木も読み、版 2 の形に直して返します。

## 単位と座標

- 単位はすべて pt (1/72 inch) です。
- 座標は物理座標で、y は下向きです。PDF は y が上向きなので、描くときに直します (`src/pdfRenderer.ts`)。
- `x`・`y` は、親の Area の content-box の左上から、この Area の border-box の左上までの位置です。`width`・`height` は border-box の大きさです。
- `margin` は border-box の外の余白で、`width`・`height` には含みません。
- `orientation` (箱の回転。反時計回り) があるとき:
  - `width`・`height` は回転前の大きさです。
  - `x`・`y` は回転後の外接矩形の左上です。
  - 子の座標は、回転前の局所座標です。
- `GlyphArea.rotation` は字の回転 (時計回り) で、箱の回転 `orientation` とは別のものです。

## 節と子

子は `childrenOf()` が返します。並びは描く順で、先のものが下になります。

| type | 子 |
|---|---|
| `sheet` | `page` |
| `page` | `behindAreas` (本文の背面) → `regionBody` → `absoluteAreas` |
| `ruby` | `base` (親文字) → `ruby` (ルビ) |
| `tate-chu-yoko` | `glyphs` |
| `glyph`・`image` | なし |
| ほか (`region-body`・`block`・`line`・`inline`・`table`・`table-row`・`table-cell`) | `children` |

木をたどるときは `walkAreas()` (1 つの節から) か `walkAreaTree()` (文書のすべてのシート) を使います。どちらも深さ優先・前順です。

## JSON への書き出しと読み込み

- `serializeAreaTree(tree)` は、木を JSON の文字列にします。`undefined` の欄は書きません。
- `parseAreaTree(json)` は、JSON の文字列から木を読みます。版 (`schemaVersion`) と、節の形 (種類・`x`・`y`・`width`・`height` が数であること・子の欄) を確かめ、合わなければ `AreaTreeFormatError` を投げます。
- 読み直した木は、描く処理 (`paintSheet`・`renderPdf`) にそのまま渡せます。ただし、この 2 つと FontManager・AssetStore は内部の関数・クラスで、パッケージの入口 (`kumiori`) からは出していません。公開 API で描けるのは、`typeset` の結果 (`renderPage`・`toPdf`) だけで、`parseAreaTree` で読み直した木を描く口は、いまはありません (読み直した木は、調べる・比べる・保存するために使います)。版 1 の木は、版 2 の形に直してから返します。書体と画像は、書き出したときと同じ FontManager・AssetStore が要ります (`test/areaTree.test.ts` で、往復した木の描き方が同じことを確かめています)。

## 罫線の辺の欄

- `BorderSide.symmetric`: 破線・点線・鎖線の模様を、辺ごとに辺の中央に対して対称に置きます (CSS の罫線)。無ければ、辺を時計回りにたどって模様を続けます。
- `BorderSide.waveStroke`・`BorderSide.waveLength`: 波線 (`style` が `wave`) の線の太さと、波の 1 周期の長さ (pt) です。下線・上線・取り消し線の波線 (CSS の `text-decoration-style: wavy`) に付きます。無ければ、罫線の幅から決めます (線は幅の 1/8、周期は幅の約 6 倍)。
- `BorderSide.collapse`: 表の罫線の重ね合わせ (collapse) で決めた、セルの辺の描き方です (`CollapsedSide`)。
  - `paintWidth`: 隣のセルと半分ずつ持つ線を、この太さで描きます (`width` はセルが取る場所で、線の太さの半分)。
  - `noPaint`: 場所だけ取り、線は描きません (隣のセルが描きます)。
  - `tableEdge`: 表の外周の辺です。角の突き合わせを、表の外の角だけにするのに使います。
- `GlyphArea.advance` は、組版上の進行方向の送り幅 (字間・詰めを含む) です。

## 元の入力への参照

- `sourceRef` は、その Area を作った入力 (`LDocument`) の節の番号です。`documentNodes(doc)` (`src/areaTree.ts`。中身は `src/sourceRef.ts`) が返す並びの位置で、`documentNodes(doc)[area.sourceRef]` が元の節です。
- 並びは、`type` の欄 (文字列) を持つ物を、深さ優先・前順 (欄の並びは入力の物のまま) に並べたものです。
- 付く Area: block・表・行・セル・画像・ルビ・縦中横、と字。字は、それを含む inline の番号 (inline の外の字は、それを含む block の番号) です。
- 静的な内容 (柱など) は、ページごとに写した節から組みますが、写した節にも元の節の番号を引き継ぎます。
- 組版の中で作る節 (脚注の番号、リストのラベルの表など) から作った Area には、付かないことがあります。

## 書体・画像の一覧と字形の番号

- `AreaTree.resources` は、木が使う書体と画像の一覧です (`src/areaResources.ts`。組版の終わりに付けます)。
  - `fonts`: `id` (`GlyphArea.fontId` が指す名前)・`family`・`weight`・`postscriptName`・`unitsPerEm` と、書体のファイルのバイト列の `sha256`。
    - 可変フォント (OpenType Font Variations) は、使った軸の値の組ごとに「実体」(その形の静的な書体) を作って組むので、実体ごとに 1 項目になります。実体の項目には、`variation` (軸の値。札 → 値。書体のすべての軸) と `sourceSha256` (元の可変フォントのファイルのバイト列の SHA-256) が付きます。`sha256` は、実体にした静的な書体のバイト列のものです (`glyphIds`・`glyphPositions` は、その書体での値。字形の番号は元の可変フォントと同じ)。
    - 実体を使う字の `GlyphArea.fontFamily` は、書体の名前の後ろに、太さ以外の軸の値の印が付きます (`css:Inter{;opsz=20,wdth=75}`。`{;` の後ろは、札 = 値の並び。`font-variation-settings` と同じ意味)。`fontWeight` は、太さの軸の値 (書体の範囲に収めた太さ) です。この名前と太さで、同じ実体が引けます。可変フォントを読み込んでいない文書の `fontFamily` には、印は付きません。
  - `images`: `src`・`mime`・自然な大きさ (`width`・`height`。CSS px) と、画像のファイルのバイト列の `sha256` (バイト列があるとき)。
- `GlyphArea.text` は、字の単位 1 つ分の文字列です。ふつうは 1 字ですが、書記素クラスタ (UAX #29 の拡張書記素クラスタ: 基底の字 + 結合文字・異体字セレクタ、絵文字の並びなど)、合字にする字の並び、つながる字 (アラビア文字など) の並びは、2 字以上が 1 つの `GlyphArea` になります。`advance` は、その並びを 1 つの書体で組んだ送りの合計です。
- `GlyphArea.glyphIds` は、描く字形の番号です。`text` を書体の OpenType の機能 (`features`) で組んだ結果で、左から右へ描く順です (PDF に書くときと同じやり方)。
- `GlyphArea.glyphPositions` は、字形ごとの [送り, 横のずらし, 縦のずらし] です (書体の単位。`unitsPerEm` で 1 em)。書体の GPOS で調整した位置で、字形が 2 つ以上あり、送りが書体の送り幅と違うか、ずらしがあるときだけ付きます (アラビア文字の記号の位置、基底の字に載せる結合文字の位置など)。PDF は、これがあれば字形ごとに位置を決めて書きます。
- `GlyphArea.fontPalette` は、色の付いた字形 (OpenType の COLR/CPAL・SVG の表) のパレットの選び方です (CSS の `font-palette` と `@font-palette-values` を、その字の書体に当てた結果)。`base` はパレットの番号、`colors` は色の差し替え ([色の番号, `#rrggbb` か `#rrggbbaa`] の並び)。既定のパレット (0 番で、差し替え無し) のときと、パレットを持たない書体の字には付きません。色の付いた字形そのもの (層・グラデーション・画像) は木に入れず、描くときに書体のファイルから読みます。
- 字形の番号と位置は、組版で測るときと同じ機能の組で組みます (字の間の kern と任意の合字は、組版が別に扱うので当てません)。
- SHA-256 は `src/sha256.ts` (FIPS 180-4) で計算します。試験で Node の crypto と同じ値になることを確かめています。

## 今の制約

- `sourceId` は、元の要素に明示の id があるときだけ付きます。inline の id は、inline の Area ではなく、その中身の最初の字 (または箱) の Area に付きます。
- PDF (`renderPdf`) は、字形の番号 (`glyphIds`) があればそれを書きます (組版で測った字形と同じ。`text` は ToUnicode に使います。合字の字 (U+FB01 など。組版で fi などを置き換えたもの) は、元の字の並び (fi など) にします)。無ければ、字を書体で組み直して書きます。画面 (Canvas) は字 (`text`) から描きます。
- 書体と画像のデータは木の中にありません。木には識別 (SHA-256) だけがあります。同じ書体・画像のファイルがあれば、字形の番号を使って木から描けます。
- 木を JSON にして読み直すと、同じ FontManager と AssetStore があれば同じに描けます (`test/areaTree.test.ts`)。
