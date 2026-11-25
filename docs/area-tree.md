> English: [en/area-tree.md](en/area-tree.md)

# Area Tree (組版の結果) の形

`LayoutEngine.layout()` が返す `AreaTree` の規則を、ここにまとめます。型は `src/types.ts`、たどる関数は `src/areaTree.ts` にあります。

## バージョン

- `AreaTree.schemaVersion` は形のバージョンです。今は `3` で、値は `AREA_TREE_SCHEMA_VERSION` (`src/areaTree.ts`) から入ります。
- フィールドの意味や子の持ち方を変えたら、バージョンを上げます。
  - 1: 最初のバージョン。
  - 2: 表の罫線の重ね合わせの描画の仕方 (`paintWidth`・`noPaint`・`tableEdge`) を、`BorderSide` のフィールドから `BorderSide.collapse` の下に移しました。
  - 3: `paintWidth` が `width` より小さい辺 (線をボックスの縁から内へずらして描画する) を追加しました (表の太さの違う罫線の中心をそろえるため)。
- `parseAreaTree` はバージョン 1 の木も読み、今のバージョンの形に直して返します。バージョン 2 の木は、そのまま今のバージョンの木として読みます。
- `warnings` (組版の警告の文) と同じイベントを、名前・重大度で持つ `diagnostics` ([diagnostics.md](diagnostics.md)) は、診断のある木にだけ付きます (無くてもよいフィールドなので、バージョンは変えていません。診断の無い木の形は前と同じです)。

## 単位と座標

- 単位はすべて pt (1/72 inch) です。
- 座標は物理座標で、y は下向きです。PDF は y が上向きなので、描画するときに直します (`src/pdfRenderer.ts`)。
- `x`・`y` は、親の Area の content-box の左上から、この Area の border-box の左上までの位置です。`width`・`height` は border-box の大きさです。
- `margin` は border-box の外の余白で、`width`・`height` には含みません。
- `orientation` (ボックスの回転。反時計回り) があるとき:
  - `width`・`height` は回転前の大きさです。
  - `x`・`y` は回転後の外接矩形の左上です。
  - 子の座標は、回転前の局所座標です。
- `GlyphArea.rotation` は文字の回転 (時計回り) で、ボックスの回転 `orientation` とは別のものです。
- 罫線の辺の色 (`border.*.color`) は、`transparent` なら描画せず (太さは取る)、`#rrggbbaa` (半透明) なら、その濃さで下の背景に重ねて描画します。
- 背景 (`backgroundColor`・`backgroundImage`):
  - `backgroundImage` は、いちばん手前の背景の画像です (大きさは解決済み)。`under` は、その後ろに重ねる画像の並び (手前のものから順) です。
  - 画像ごとの `origin` は位置の基準の領域 (`border-box`・`content-box`。無ければ padding のボックス)、`clip` は描画する範囲 (`border-box`・`content-box`。無ければ padding のボックス) です。HTML の背景は、`background-clip` の初期値が `border-box` なので、ふつう `clip: "border-box"` を持ちます (罫線の下にも描画する)。XSL-FO の背景は `clip` を持ちません (XSL 1.1 §4.9.4: 背景は padding の矩形に描画する)。
  - `backgroundClip` は背景の色を塗る範囲 (`padding-box`・`content-box`) です。無ければ border-box (`width` × `height`) に塗ります。
- 画像 (`image`) の `fit` (CSS の `object-fit` の `cover`・`contain`・`none`・`scale-down`) があるとき、`width` × `height` は枠の大きさで、画像は本来の大きさ (`naturalWidth` × `naturalHeight`) から大きさを決めて枠の中に置き、枠でクリッピングします。`fitPosition` (CSS の `object-position`) は枠の中での位置です (無ければ中央)。
- 画像 (`image`) の `language` は、画像を置いた所の言語 (`xml:lang`・`lang`) です。SVG の画像の `systemLanguage` (SVG 2 §5.6.5) を、この言語で照合して描画します (この言語が、照合する言語の指定 `svgLanguages` に勝つ。どちらも無ければ実行環境の言語)。
- `transform` (描画するときの変換。CSS の `transform`) があるとき:
  - 値は行列 `[a, b, c, d, e, f]` で、x' = a·x + c·y + e、y' = b·x + d·y + f です (y は下向き)。
  - 行列の座標の原点は、この Area の `x`・`y` の点 (border-box の左上) です。
  - この Area とその子孫を描画するときだけに掛けます。`x`・`y`・`width`・`height` と子の座標は、変換の前のままです (組版は変換を知りません)。
- `opacity` (不透明度。CSS の `opacity`。0 以上 1 未満) があるとき、この Area とその子孫をまとめて 1 枚の絵にしてから、その濃さで重ねます (中の重なりは濃くなりません)。`transform` と両方あれば、変換した絵を重ねます。
- `transform`・`opacity` の付いた Area は、回り込み (`float`) のある所でも、背景と中身に分けずに、行内の中身の段でまるごと描画します。
- 行の中の要素 (枠の付いた `span` など) に `opacity`・`transform` が付くと、その枠と中身をまとめた `inline` の Area (`sourceRef` は無し) を作り、そこに付けます。
- `outline` (輪郭線。CSS の `outline`。`{ width, color, style?, offset? }`。pt) があるとき、この Area の border-box の外側に、`offset` だけ離して (負の値は内側へ)、4 辺とも同じ線を描画します。場所は取りません (`x`・`y`・`width`・`height` は変わりません)。この Area の中身と罫線より後に描画し、`borderRadius` のある Area では角も丸めます。行の中の要素の輪郭線は、行ごとに、描画するだけの `block` の Area (子は無し) として、行の子の末尾に置きます。
- `clipRect` (クリッピングの矩形。CSS の `clip: rect(…)`。`{ x, y, width, height }`。`x`・`y` は、この Area の border-box の左上から。pt) があるとき、この Area の影・背景・罫線・輪郭線と子孫を、その矩形でクリッピングして描画します (`clip` は、子だけを padding のボックスでクリッピングします)。幅か高さが 0 以下なら、この Area は何も描画しません。

## 節と子

子は `childrenOf()` が返します。並びは描画する順で、先のものが下になります。

| type | 子 |
|---|---|
| `sheet` | `page` |
| `page` | `behindAreas` (本文の背面) → `regionBody` → `absoluteAreas` |
| `ruby` | `base` (親文字) → `ruby` (ルビ) |
| `tate-chu-yoko` | `glyphs` |
| `glyph`・`image` | なし |
| ほか (`region-body`・`block`・`line`・`inline`・`table`・`table-row`・`table-cell`) | `children` |

木をたどるときは `walkAreas()` (1 つの節から) か `walkAreaTree()` (文書のすべてのシート) を使います。どちらも深さ優先・前順です。

## ページの番号

- `page` の `pageNumber` は、ページ番号の数です (XSL-FO の `initial-page-number`、CSS の `counter-reset: page`・`counter-set: page` の振り直しを反映したもの)。シートの順の番号ではありません。
- `page` の `pageNumberFormat` は、そのページのページ番号の書式です (XSL-FO の `fo:page-sequence` の `format`、CSS では余白のボックスの `counter(page, <型>)` の型を書式にしたもの。`i`・`I`・`a`・`A`・`01`・`一`・`①` など、前後の文字も含む)。10 進 (`1`) のページには付きません (無くてもよいフィールドなので、バージョンは変えていません)。
- PDF のページラベル (ビューアーが出すページの番号。ISO 32000-1 §12.4.2) は、この 2 つから作ります。

## JSON への書き出しと読み込み

- `serializeAreaTree(tree)` は、木を JSON の文字列にします。`undefined` のフィールドは書きません。
- `parseAreaTree(json)` は、JSON の文字列から木を読みます。バージョン (`schemaVersion`) と、節の形 (種類・`x`・`y`・`width`・`height` が数であること・子のフィールド) を確認し、合わなければ `AreaTreeFormatError` を投げます。
- 読み直した木は、描画する処理 (`paintSheet`・`renderPdf`) にそのまま渡せます。ただし、この 2 つと FontManager・AssetStore は内部の関数・クラスで、パッケージの入口 (`kumiori`) からは出していません。公開 API で描画できるのは、`typeset` の結果 (`renderPage`・`renderPageToSvg`・`renderPageToPng`・`toPdf`) だけで、`parseAreaTree` で読み直した木を描画する口は、いまはありません (読み直した木は、調べる・比べる・保存するために使います)。バージョン 1・バージョン 2 の木は、今のバージョンの形に直してから返します。フォントと画像は、書き出したときと同じ FontManager・AssetStore が要ります (`test/areaTree.test.ts` で、往復した木を描画した結果が同じことを確認しています)。

## 罫線の辺のフィールド

- `BorderSide.symmetric`: 破線・点線・鎖線のパターンを、辺ごとに辺の中央に対して対称に置きます (CSS の罫線)。無ければ、辺を時計回りにたどってパターンを続けます。
- `BorderSide.waveStroke`・`BorderSide.waveLength`: 波線 (`style` が `wave`) の線の太さと、波の 1 周期の長さ (pt) です。下線・上線・取り消し線の波線 (CSS の `text-decoration-style: wavy`) に付きます。無ければ、罫線の幅から決めます (線は幅の 1/8、周期は幅の約 6 倍)。
- `BorderSide.collapse`: 表の罫線の重ね合わせ (collapse) で決めた、セルの辺の描画の仕方です (`CollapsedSide`)。
  - `paintWidth`: 線を描画する太さです。`width` (セルが取る場所) より大きいときは、隣のセルと半分ずつ持つ線で、ボックスの外へ (`paintWidth` − `width`) だけはみ出して描画します (`width` は線の太さの半分)。
    `width` より小さいときは、ボックスの縁から (`width` − `paintWidth`) だけ内に描画します (表の外周や、互換の組み方の内側の線で、太さの違う線の中心をそろえるため)。
  - `noPaint`: 場所だけ取り、線は描画しません (隣のセルが描画します)。
  - `tableEdge`: 表の外周の辺です。角の突き合わせを、表の外の角だけにするのに使います。
- `GlyphArea.advance` は、組版上の進行方向の送り幅 (字間・詰めを含む) です。

## 元の入力への参照

- `sourceRef` は、その Area を作った入力 (`LDocument`) の節の番号です。`documentNodes(doc)` (`src/areaTree.ts`。中身は `src/sourceRef.ts`) が返す並びの位置で、`documentNodes(doc)[area.sourceRef]` が元の節です。
- 並びは、`type` のフィールド (文字列) を持つ物を、深さ優先・前順 (フィールドの並びは入力の物のまま) に並べたものです。
- 付く Area: block・表・行・セル・画像・ルビ・縦中横、と文字。文字は、それを含む inline の番号 (inline の外の文字は、それを含む block の番号) です。
- 静的な内容 (柱など) は、ページごとにコピーした節から組みますが、コピーした節にも元の節の番号を引き継ぎます。
- 組版の中で作る節 (脚注の番号、リストのラベルの表など) から作った Area には、付かないことがあります。
- 行の中のリンク・注釈の範囲のボックス (描画しない `block` の Area) には、そのリンク・注釈を持つ inline の番号が付きます。

## タグ付き PDF の構造

- `AreaTree.structure` は、タグ付き PDF の構造ツリーです (`src/structure.ts`)。入力が構造ツリーを持つとき (HTML・XSL-FO の読み込みの `tagged`。API・コマンドの `tagged`・`--tagged`) だけあります。
  - `nodes`: 構造の節の並び (0 番が文書)。節は、PDF の標準の構造の型の名前 (`role`。ISO 32000-1 §14.8.4。飾りは `Artifact`)・独自の型の名前 (`custom`。XSL-FO の `role`・`axf:pdftag`。RoleMap で `role` に対応させる)・親の番号 (`parent`)・子の番号 (`kids`。文書の順)・言語 (`lang`)・代替テキスト (`alt`)・略語の展開 (`expansion`) を持ちます。表のセルは、見出しのセルの向き (`scope`)・またぐ行と列の数 (`rowSpan`・`colSpan`)・見出しのセルの番号 (`headers`)、注 (Note) と `headers` で指されたセルは ID (`sid`) を持ちます。`anchor` は、親の中で置く所の目印の節の番号です (脚注の本体 (Note) を、本文の参照の印 (Reference) の後ろに置く)。
  - `tags`: 入力の節の番号 (`sourceRef`) → 構造の節の番号の表です (-1 は無し)。Area の中身 (文字・画像) は、その Area か、いちばん近い祖先の Area の `sourceRef` から、構造の節を引きます。
- 描画するとき (`src/paint.ts`)、ボックスの影・背景・罫線・輪郭線と用紙の背景・トンボは飾り、文字・画像・縦中横は中身として区別して描画します (`Painter.tag`)。繰り返した表の見出し・脚 (`isRepeatedHeader`) の中は、ページの飾りです。柱の飾りは、上・下の柱 (`artifact` が `header`・`footer`) を Pagination の Subtype Header・Footer で書きます。ルビの親文字とルビの文字は `LRuby.tagParts` の番号 (RB・RT。圏点の点は飾り) を持ちます。脚注の参照の印の文字と、脚注の本体の先頭の番号の文字は、読み込みが作った中身の無い入力の節 (`LFootnote.tagParts`) の番号を持ち、それぞれ Reference・Lbl の構造の節に当たります。

## フォント・画像の一覧と字形の番号

- `AreaTree.resources` は、木が使うフォントと画像の一覧です (`src/areaResources.ts`。組版の終わりに付けます)。
  - `fonts`: `id` (`GlyphArea.fontId` が指す名前)・`family`・`weight`・`postscriptName`・`unitsPerEm` と、フォントのファイルのバイト列の `sha256`。
    - 可変フォント (OpenType Font Variations) は、使った軸の値の組ごとに「インスタンス」(その形の静的なフォント) を作って組むので、インスタンスごとに 1 項目になります。インスタンスの項目には、`variation` (軸の値。タグ → 値。フォントのすべての軸) と `sourceSha256` (元の可変フォントのファイルのバイト列の SHA-256) が付きます。`sha256` は、インスタンスにした静的なフォントのバイト列のものです (`glyphIds`・`glyphPositions` は、そのフォントでの値。字形の番号は元の可変フォントと同じ)。アウトラインが CFF2 の可変フォントは、既定の形もインスタンス (静的な CFF のフォント) になります。
    - インスタンスを使う文字の `GlyphArea.fontFamily` は、フォントの名前の後ろに、太さ以外の軸の値の印が付きます (`css:Inter{wdth=75,opsz=20}`・`css:Inter{;GRAD=88}`。`{` と `;` の間は、性質 (`font-stretch`・`font-style`・`font-optical-sizing`) から決まる値で、wdth・ital か slnt・opsz の順。`;` の後ろは `font-variation-settings` の値で、タグ = 値をタグの順に並べる)。`fontWeight` は、太さの軸の値 (フォントの範囲に収めた太さ) です。この名前と太さで、同じインスタンスが引けます。斜体のフォント・幅の違うフォント (フォントのファイルそのものが傾き・幅を持つもの) で組んだ文字の `fontFamily` にも、そのフォントを指す印が付きます (`Arial{ital=1}`・`Arial{wdth=75}`・`Arial{wdth=75,ital=1}`。斜めのフォントは `{slnt=14}`。`;` の前に書きます)。この文字には `italic` (傾けて描画する印) は付きません。可変フォントも、斜体・幅の違うフォントも読み込んでいない文書の `fontFamily` には、印は付きません。
  - `images`: `src`・`mime`・自然な大きさ (`width`・`height`。CSS px) と、画像のファイルのバイト列の `sha256` (バイト列があるとき)。
- `GlyphArea.text` は、文字の単位 1 つ分の文字列です。ふつうは 1 字ですが、書記素クラスタ (UAX #29 の拡張書記素クラスタ: 基底の文字 + 結合文字・異体字セレクター、絵文字の並びなど)、合字にする文字の並び、つながる文字 (アラビア文字など) の並びは、2 字以上が 1 つの `GlyphArea` になります。`advance` は、その並びを 1 つのフォントで組んだ送りの合計です。
- `GlyphArea.glyphIds` は、描画する字形の番号です。`text` をフォントの OpenType の機能 (`features`) で組んだ結果で、左から右へ描画する順です (PDF に書くときと同じやり方)。
- `GlyphArea.glyphPositions` は、字形ごとの [送り, 横のずらし, 縦のずらし] です (フォントの単位。`unitsPerEm` で 1 em)。フォントの GPOS で調整した位置で、字形が 2 つ以上あり、送りがフォントの送り幅と違うか、ずらしがあるときだけ付きます (アラビア文字の記号の位置、基底の文字に載せる結合文字の位置など)。PDF は、これがあれば字形ごとに位置を決めて書きます。
- `GlyphArea.fontPalette` は、色の付いた字形 (OpenType の COLR/CPAL・SVG の表) のパレットの選び方です (CSS の `font-palette` と `@font-palette-values` を、その文字のフォントに当てた結果)。`base` はパレットの番号、`colors` は色の差し替え ([色の番号, `#rrggbb` か `#rrggbbaa`] の並び)。既定のパレット (0 番で、差し替え無し) のときと、パレットを持たないフォントの文字には付きません。色の付いた字形そのもの (レイヤー・グラデーション・画像) は木に入れず、描画するときにフォントのファイルから読みます。
- `GlyphArea.hyphen` は、分綴で行末に追加した文字 (CSS の `hyphenate-character`・XSL-FO の `hyphenation-character`。既定は `-`) の印です。入力の文字ではありません。タグ付き PDF では、その文字の置き換えの文字列 (`ActualText`) をソフトハイフン (U+00AD) にして書きます (ISO 32000-1 §14.8.2.5・§14.9.4)。
- `GlyphArea.breakSpace` は、空白の所で分けた行の、最後の文字 (読む順。ぶら下げた文字があればそれ) に付く、行末で捨てた空白の文字です (ふつうは `" "`)。段落の終わりの行と、強制改行で終わる行には付きません。タグ付き PDF では、その文字の後ろに空白を見えない文字として書き、構造の順に読んだときに、行をまたぐ語がつながらないようにします (§14.8.2.5)。文字を取り出すときは、`hyphen` の文字を除き、`breakSpace` を追加すると、入力の文字の並び (空白をまとめた後のもの) に戻ります。
- 字形の番号と位置は、組版で測るときと同じ機能の組で組みます (字間の kern と任意の合字は、組版が別に扱うので当てません)。
- SHA-256 は `src/sha256.ts` (FIPS 180-4) で計算します。試験で Node の crypto と同じ値になることを確認しています。

## 今の制約

- `sourceId` は、元の要素に明示の id があるときだけ付きます。inline の id は、inline の Area ではなく、その中身の最初の文字 (またはボックス) の Area に付きます。
- PDF (`renderPdf`) は、字形の番号 (`glyphIds`) があればそれを書きます (組版で測った字形と同じ。`text` は ToUnicode に使います。合字の文字 (U+FB01 など。組版で fi などを置き換えたもの) は、元の文字の並び (fi など) にします)。無ければ、文字をフォントで組み直して書きます。画面 (Canvas) は文字 (`text`) から描画します。
- フォントと画像のデータは木の中にありません。木には識別 (SHA-256) だけがあります。同じフォント・画像のファイルがあれば、字形の番号を使って木から描画できます。
- 木を JSON にして読み直すと、同じ FontManager と AssetStore があれば同じに描画できます (`test/areaTree.test.ts`)。
