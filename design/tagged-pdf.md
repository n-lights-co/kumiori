# タグ付き PDF (PDF/UA-1) の設計の覚え書き

レビュー台帳の OUT-51 の、調べと設計の覚え書きです (ブランチ `claude/out-51-tagged-pdf-design`)。
実装を main に入れるのは、利用者がこの設計を見て決めてからです。この覚え書きは、リリースする文書 (`docs/` など) ではありません。
規格の本文は写さず、節の番号だけを書きます。

## 1. いまの仕組み (調べた結果)

### 1.1 元の要素の情報は、どこまで残っているか

| 段 | 持っているもの | 失っているもの |
|---|---|---|
| HTML の読み込み (`src/htmlImport.ts`) → `LDocument` | 箱の種類 (`block`・`inline`・`table`・`image`…)、`id`、`language`、画像の `alt` (`img` の `alt`・`title`、`math` の `alttext`)、リンク (`link`) | 要素の名前 (h1・p・li・th…)、ARIA の `role`・`aria-*`、表の `scope`・`headers`。読み込みは要素を箱に置き換え、名前を残さない。名無しの包みの箱 (リンクにする表を包む `block` など) も作る |
| XSL-FO の読み込み (`src/xslfoImport.ts`) → `LDocument` | 同上。`role`・`source-document` は「組版に効かない性質」として読まずに捨てる (`NO_FORMATTING_EFFECT`) | FO の要素の名前、`role` |
| 組版 (`src/layoutEngine.ts`) → `LNode` → Area | `sourceRef` (入力の節の通し番号。`src/sourceRef.ts`)。block・表・行・セル・画像・ルビ・縦中横・字に付く。字は、それを含む inline (無ければ block) の番号。柱 (static-content) は写した節にも元の番号を引き継ぐ (`copySourceRef`)。ページをまたいだ断片は同じ番号を持つ | 組版の中で作る節 (脚注の番号・リストのラベルの表など) には付かないことがある。表の見出し・脚を繰り返した行は `LNode.repeated` を持ち、Area の `TableRowArea.isRepeatedHeader` に写る (Artifact の目印に使える) |
| 描く (`src/paint.ts` の `paintArea`) | Area を明示のスタックで深さ優先にたどり、`Painter` の命令 (fillRect・drawGlyph・drawImage・strokeLine・transform・group・mark…) を呼ぶ。命令には、どの Area の何 (背景・罫線・中身) かが渡らない | — |
| PDF (`src/pdfRenderer.ts` の `PdfPainter`・`renderPdfPages`) | 字は `PdfPainter` が BT〜ET の並び (run) にまとめて書く。`/Span <</ActualText …>> BDC 〜 EMC` を、字形と字が対応しない所 (合字・インド系の用字・縦中横・色つきの字形 `src/colorGlyphPdf.ts`) に書いている | StructTreeRoot・MarkInfo・StructParents・MCID はどこにも無い (`pdfinfo` は Tagged: no) |

### 1.2 どこで描かれるか

- 字: `paintArea` → `PdfPainter.drawGlyph` (行の中の字)。ルビは `RubyArea` の `base`・`ruby`、縦中横は `drawTateChuYoko` (枠をまとめて 1 つの単位にする)。
- 線・背景・影・輪郭線: `openArea` (影・背景・背景画像) と `closeArea` (罫線)、`paintOutline`。下線などの飾りの線と改訂バーも、行の Area の中で `strokeLine`・`fillRect` で描く。
- 画像: `drawImage` (ラスタ)・`drawVector` (SVG。同じ SVG は Form XObject に 1 度だけ書いて使い回す。`recordVector`・`SvgForms`)。代わりの描画 (`paintPlaceholder`) もある。
- リンク・注釈・フォームの欄: `paintArea` が `Painter.mark` を呼び、`PdfPainter` が矩形を集め、`renderPdfPages` の終わりに `addAnnotations`・`addFormFields` が注釈を作る。
- しおり: `renderPdfPages` の終わりの `addOutline`。
- 脚注: 本文の領域 (`regionBody`) の中の、ページの下端の領域に置く (傍注は横)。入力では、脚注の本文は引用の所 (`LFootnote`) にある。
- 段組み・浮動 (float・fo:float)・絶対配置: 組んだ位置に置く。描く順は、回り込みの段 (`childOrder` の bg → float → fg)、ページの `behindAreas` → `regionBody` → `absoluteAreas`。
- 柱・ノンブル (static-content・@page の余白の箱・running()): `sheetStatics` が組み、`absoluteAreas` か `behindAreas` に置く。
- 縦書き: 領域は回転せず、字の回転 (`GlyphArea.rotation`) と縦書きの書体で描く。回転した箱 (`orientation`) と `transform` は `Painter.transform`、不透明度は `Painter.group` (PDF では透明のグループの Form XObject。`PdfPainter.group`)。
- ページをまたぐ要素: block・表は、ページごとの断片 (`isContinuation`・`continuesOnNext`) に分かれ、断片は同じ `sourceRef` を持つ。
- ページの書き出しは 1 枚ずつ (`renderPdfPages`。`typesetToPdf` の `lowMemory` では、組み終えたページの領域の木を手放す)。

## 2. 仕様 (読んだ節)

- ISO 32000-1 (PDF 1.7)
  - §14.6 marked content (BMC・BDC・EMC、§14.6.2 property list)。
  - §14.7 論理構造: §14.7.1 (MarkInfo の辞書)、§14.7.2 (構造の木: StructTreeRoot・StructElem の K・P・Pg・ID・Lang・Alt・ActualText)、§14.7.3 (構造の型と RoleMap)、
    §14.7.4 (中身の項目: §14.7.4.2 marked content の項目 (MCID・MCR の Pg・Stm)、§14.7.4.3 PDF の物の項目 (OBJR)、§14.7.4.4 ParentTree・StructParents・StructParent)、§14.7.5 (構造の属性 A と O)。
  - §14.8 タグ付き PDF: §14.8.2 (本当の中身と Artifact。Artifact の Type: Pagination・Layout・Page と Subtype: Header・Footer・Watermark)、§14.8.4 (標準の構造の型)、§14.8.5 (標準の属性。表の Scope・Headers・RowSpan・ColSpan、リストの ListNumbering)。
  - §14.9 アクセシビリティの支え: §14.9.2 (言語 Lang)、§14.9.3 (代わりの説明 Alt)、§14.9.4 (置き換えの文字列 ActualText)、§14.9.5 (略語の展開 E)。
  - §12.5 注釈 (StructParent・Contents)、§12.5.6.5 リンク。
- ISO 14289-1:2014 (PDF/UA-1): §5 (版の印: XMP の pdfuaid:part)、§7.1 (全体: 中身はタグか Artifact、MarkInfo、題 dc:title と DisplayDocTitle)、§7.2 (字と言語)、§7.3 (図の代わりの文)、
  §7.4 (見出し)、§7.5 (表)、§7.6 (リスト)、§7.7 (数式)、§7.8 (柱)、§7.9 (注と参照: Note は ID を持つ)、§7.17 (しおり)、§7.18 (注釈: §7.18.1 全体、§7.18.3 ページの Tabs が S、§7.18.5 リンク)、§7.20 (XObject)、§7.21 (書体: 埋め込み・ToUnicode・.notdef)。
- XSL 1.1 §7.5 (Common Accessibility Properties): §7.5.1 source-document、§7.5.2 role (代わりの描き方への手がかり)。
- HTML Living Standard (要素の意味)、WAI-ARIA 1.2 (role・aria-label・aria-hidden・aria-level)、DPUB-ARIA 1.1 (doc-footnote・doc-noteref・doc-toc・doc-biblioentry など)、HTML-AAM (要素とアクセシビリティの役の対応)。

## 3. 設計の案

### 3.1 構造の木を、組版と別に持つ

- 読み込み (HTML・XSL-FO) が、要素ごとの構造の節 (`StructNode`) の木を作り、`LDocument.structure` に入れる。
  - 節の中身: 番号 (`id`)・構造の型 (`role`。標準の型か、RoleMap で標準の型に写す独自の名前)・親・子 (入力の順)・`lang`・`alt`・`actualText`・`expansion` (略語)・属性 (表の Scope・Headers・RowSpan・ColSpan、リストの ListNumbering)・要素の `id` (Headers・Note の ID に使う)。
  - 木の順は入力の順 (文書の論理の順) で、これがそのまま読む順になる (3.2)。
- L の節 (`LBlock`・`LInline`・`LImage`…) には、構造の節の番号 `tag?: number` を付ける (1 つの要素から箱が 2 つ以上できるとき (リストの項目のラベルと本文、包みの箱) は、それぞれに当たる構造の節の番号)。
  番号の無い箱は「透明」で、中身は、いちばん近い祖先の番号の付いた箱の構造に入る。
- 組版は、`LNode`・Area に `tag` を写す (`sourceRef` と同じ所。`copySourceRef` と同じく、写した節・断片・柱にも引き継ぐ)。
  `sourceRef` を使い回さないのは、組版の中で作る節に番号が付かないことがあり、また 1 つの入力の節が 2 つ以上の構造の節に当たることがあるため。
- 飾りの印: Area に `artifact?: 'pagination-header' | 'pagination-footer' | 'pagination' | 'layout'` を付ける (柱・ノンブル・繰り返す表の見出しと脚・リーダー・区切りの線)。
- `AreaTree.structure` (構造の木) と、Area の `tag`・`artifact` を足すので、`AREA_TREE_SCHEMA_VERSION` を 4 に上げ、`docs/area-tree.md` に書く。
- 1 枚ずつ書く (`renderPdfPages`・`lowMemory`) ときも、構造の木は組版の前に決まっているので、`PdfPageSource` に `structure` を足して渡す。ページを書きながら、構造の節ごとの中身の項目 (ページと MCID) を足していく。

### 3.2 読む順序の決め方

構造の木の順 (入力の順) を読む順とし、ページの中の描く順 (内容の流れの順) には頼らない (§14.8.2 の Page content order は、構造の木がある文書では読む順を決めない)。

- 段組み: 入力の順。段をまたいだ段落は、1 つの P に、段ごとの MCID を並べる。
- 浮動 (CSS の float・fo:float)・絶対配置: 入力の中の位置 (要素の書かれた所) に置く。fo:float は、fo:float の書かれた所。
- 脚注: Note を、引用の所 (`LFootnote` の書かれた所。段落の中) に置く。引用の印 (本文の上付きの番号) は Lbl か Reference (3.3)、脚注の本文の番号は Note の中の Lbl。Note には ID を付ける (PDF/UA-1 §7.9)。
- 柱・ノンブル・余白の箱: Artifact (3.4)。構造の木に入れない。
- 縦書き: 入力の順のまま (縦書きでも論理の順は変わらない)。縦中横は、まわりの字と同じ構造の中身 (ActualText の /Span はそのまま)。
- ページをまたぐ段落・表: 1 つの構造の節に、ページごとの MCR (`Pg` 付き) を並べる。表の断片は 1 つの Table、行がページで分かれたセルは 1 つの TD に 2 つの MCID。
- 回り込みの描き分け (bg → float → fg) で、同じ箱の中身が 2 度に分けて描かれても、どちらも同じ構造の節の MCID になるだけで、読む順は木の順のまま。

### 3.3 要素と構造の型の対応表

HTML (要素 / ARIA の role):

| 入力 | PDF の構造の型 | 覚え書き |
|---|---|---|
| 文書 (html) | Document | カタログの /Lang は html の lang |
| `body` | (透明) | |
| `main` | Div (RoleMap で Main → Div も可) | PDF 1.7 に Main は無い |
| `article` | Art | |
| `section` | Sect | |
| `nav` | Div (`role="doc-toc"` なら TOC) | |
| `aside` | Div (`role="doc-footnote"`・`doc-endnote` なら Note) | |
| 本文の中の `header`・`footer` | Div | ページの柱ではないので Artifact にしない |
| `div` | Div (中身が行だけなら P にしない。Div のまま) | |
| `p`・`address` | P | |
| `h1`〜`h6`、`role="heading"` + `aria-level` | H1〜H6 | 番号の跳び (h1 の次の h3) は PDF/UA-1 §7.4 の検査で警告になる。読み込みの警告に出す |
| `blockquote` | BlockQuote | |
| `q` | Quote | |
| `pre` | P (中に `code` だけなら Code) | |
| `code` | Code | |
| `ul`・`ol`、`role="list"` | L (属性 ListNumbering: `list-style-type` から Disc・Circle・Square・Decimal・UpperRoman・LowerRoman・UpperAlpha・LowerAlpha・None) | |
| `li`、`role="listitem"` | LI の中に Lbl (`::marker`) と LBody | |
| `dl` / `dt` / `dd` | L / LI の中の Lbl / LBody | |
| `table` | Table | |
| `caption` | Caption (Table の最初の子) | |
| `thead`・`tbody`・`tfoot` | THead・TBody・TFoot | |
| `tr` | TR | |
| `th` | TH (属性 Scope: `scope` 属性。無ければ、THead の中なら Column、行の頭なら Row) | §14.8.5 の表の属性 |
| `td` | TD (属性 Headers: `headers` 属性の id を、TH の構造の節の ID にする。RowSpan・ColSpan) | |
| `img`・`svg`・`object`・`role="img"` | Figure (Alt: `alt`・`aria-label`・SVG の `title`) | `alt=""`・`role="presentation"`・`role="none"` は Artifact |
| `figure` / `figcaption` | Div / Caption | 中の img が Figure |
| `math` | Formula (Alt: `alttext`・`aria-label`) | |
| `a[href]` | Link (中身の MCID と、注釈の OBJR) | 3.6 |
| `abbr[title]` | Span (E: title) | §14.9.5 |
| `ruby` / `rb`・親文字 / `rt` / `rp` | Ruby / RB / RT / RP | |
| `span` などの行の中の要素 | 透明。`lang` が親と違うか、`role` があれば Span | `em`・`strong` は PDF 1.7 に型が無いので透明 (RoleMap で Em → Span にもできる) |
| `br`・`wbr` | (無し) | |
| `hr` | Artifact (Layout) | |
| フォームの部品 | Form (欄の注釈の OBJR) | |
| `aria-hidden="true"` | Artifact | |
| 生成した内容 (`::before`・`::after`・counter) | 要素の構造の中身 | 柱の中のものは Artifact |
| DPUB-ARIA の `doc-noteref` / `doc-biblioentry` / `doc-toc` の項目 | Reference / BibEntry / TOC・TOCI | |

XSL-FO (要素 / `role`):

| 入力 | PDF の構造の型 | 覚え書き |
|---|---|---|
| fo:root | Document | /Lang は fo:root の xml:lang (無ければ最初の page-sequence の language) |
| fo:page-sequence | Part | |
| fo:flow | (透明) | |
| fo:static-content | Artifact (Pagination。region-before → Header、region-after → Footer、ほか → Subtype 無し) | 中の retrieve-marker で取り出した中身も |
| fo:block (中が行) | P | |
| fo:block (中が block だけ) | Div | |
| fo:block-container | Div | |
| fo:inline・fo:wrapper | 透明 (`role` か、親と違う language があれば Span) | |
| fo:list-block / list-item / list-item-label / list-item-body | L / LI / Lbl / LBody | |
| fo:table-and-caption / fo:table-caption | Div / Caption | |
| fo:table / table-header / table-body / table-footer / table-row | Table / THead / TBody / TFoot / TR | |
| fo:table-cell | TD (table-header の中は TH、Scope Column) | |
| fo:external-graphic・fo:instream-foreign-object | Figure (MathML なら Formula) | 代わりの文は 3.5 |
| fo:basic-link | Link | |
| fo:footnote / 中の fo:inline / fo:footnote-body | (透明) / Lbl か Reference / Note | |
| fo:float | Div (書かれた所に置く) | |
| fo:leader | Artifact (Layout) | 目次の点線など |
| fo:page-number・fo:page-number-citation | 中身 (Span にしない。親の構造の中身) | |
| fo:bookmark-tree | しおり (構造の木には入れない) | |

`role` (XSL 1.1 §7.5.2・HTML の `role`):
- XSL-FO の `role` は、値が PDF の標準の構造の型の名前 (H1・TOC・TOCI・Note・BlockQuote…) なら、その型にする (上の表の既定より勝つ)。
  標準の型でない名前は、独自の型として書き、RoleMap で、上の表の既定の型に写す (§14.7.3)。
  `role` は規格の属性で、意味は「代わりの描き方への手がかり」なので、互換の指定に関わらず読む。`source-document` は読まない (PDF の構造に当たる所が無い)。
- HTML の `role` は ARIA の役として読み、上の表の対応にする。知らない役は無視する (要素の既定の型のまま)。
- アンテナハウスの拡張 (`axf:` の付いた属性で、構造の型・代わりの文・Artifact を指すもの) は、CLAUDE.md の決まりのとおり、どのモードでも読む。名前と中身は、実装の段で公開の説明で確かめてから決め、根拠をコメントに書く。

### 3.4 飾りを Artifact にする決まり

PDF/UA-1 §7.1: 中身は、どれも構造の木の項目か Artifact のどちらか。

| 描くもの | 扱い |
|---|---|
| 箱の背景の色・背景画像・影・罫線・輪郭線・斜めの罫線 | Artifact (Layout) |
| 下線・上線・取り消し線・改訂バー・行番号 | Artifact (Layout) (行番号は Artifact (Layout)) |
| 柱・ノンブル・@page の余白の箱・running() の中身・fo:static-content | Artifact (Pagination。Subtype Header・Footer) |
| 繰り返した表の見出し・脚 (2 ページ目から) | Artifact (Pagination)。最初のものは本当の中身 |
| リーダー (fo:leader・CSS の leader()) | Artifact (Layout) |
| 脚注の区切りの線 (xsl-footnote-separator・@footnote の罫線) | Artifact (Layout) |
| 用紙の背景・トンボ・ガイド | Artifact (Page・Layout) |
| 画像のない所の代わりの描画 (`paintPlaceholder`) | Figure の中身 (代わりの文があれば) |
| `alt=""`・`aria-hidden`・`role="presentation"` の画像 | Artifact |
| リストのラベル (`::marker`・list-item-label) | 本当の中身 (Lbl) |

Artifact は `/Artifact <</Type /Layout>> BDC 〜 EMC` で包み、MCID を付けない (構造の木に入れない)。

### 3.5 代わりの文・言語・表の見出し・リンク

- 図の代わりの文: Figure・Formula の `Alt` (§14.9.3)。HTML は `alt`・`aria-label`・`aria-labelledby` (指す要素の字)・SVG の `title`、MathML は `alttext`。
  XSL-FO 1.1 には代わりの文の性質が無いので、アンテナハウスの拡張 (3.3 の末尾) か、`role` で付けた独自の印から取る。無ければ、PDF/UA の指定のときは警告に出す (PDF/UA-1 §7.3)。
  接頭辞の無い名前に他の製品が足した書き方は、CLAUDE.md の決まりのとおり、互換の指定のときだけ読む。
- 言語: カタログの `/Lang` (文書の言語)。構造の節の `lang` が親と違うときだけ、その節に `/Lang` (§14.9.2)。Artifact の中は付けない。
  文書の言語が無いときは、PDF/UA の指定で警告に出す (PDF/UA-1 §7.2)。
- 表の見出し: TH に `/A <</O /Table /Scope /Column|/Row|/Both>>`、TD に `/A <</O /Table /Headers [...]>>` (§14.8.5)。結合したセルは RowSpan・ColSpan。
  Headers の値は TH の構造の節の ID (要素の id か、無ければ作った ID)。
- リンク: Link の構造の節の子に、リンクの字の MCID と、注釈の OBJR (`<</Type /OBJR /Obj 注釈>>`) を並べる (§14.7.4.3)。注釈に `/StructParent` (ParentTree の鍵) と `/Contents` (代わりの文。リンクの字か `aria-label`・`title`)。
  注釈のあるページに `/Tabs /S` (PDF/UA-1 §7.18.3)。1 つのリンクが 2 行・2 ページに分かれて注釈が 2 つ以上になるときは、どの注釈も同じ Link に OBJR で入れる。
- フォームの欄: Form の構造の節に欄の注釈の OBJR。`/TU` (欄の説明) を付ける。

### 3.6 エリアツリーに印を通す方法と、書き出し

**描く処理 (`src/paint.ts`)**
- `Painter` に、任意の命令 `tag?(t: PaintTag): void` を足す (`PaintTag` は `{ struct: number } | { artifact: ArtifactKind }`)。
  `paintArea` は、命令を呼ぶ前に、いまの印を決めて `tag` を呼ぶ (変わったときだけ)。
  - 影・背景・罫線・輪郭線を描く前は Artifact (Layout)、柱・繰り返した見出しの Area の中は Artifact (Pagination)。
  - 字・画像・縦中横・ルビは、`tag` の付いた最も近い祖先の構造の節 (スタックの `OpenBox` に、いまの構造の節を持たせる)。
  - Canvas・SVG の描画先は `tag` を実装しないので、いままでと同じ。
- `mark` (リンク・注釈・欄) にも、いまの構造の節を渡し、注釈と構造の節を結ぶ。

**PDF (`src/pdfRenderer.ts`)**
- `PdfPainter.tag`: 印が変わったら、書きかけの字の並びを閉じ (`flushText`。BT〜ET の中で印を変えない)、開いている marked content を `EMC` で閉じ、新しい印の `BDC` を書く。
  - 構造の節: `/<型> <</MCID n>> BDC`。MCID はページごとに 0 から。ページの「MCID → 構造の節」の並びを覚える。
  - Artifact: `/Artifact <</Type /Pagination /Subtype /Header>> BDC` など。
  - 字の並びの中の `/Span <</ActualText …>> BDC 〜 EMC` は、MCID の付いた marked content の中に入れ子にする (MCID の無い入れ子なので、構造の項目にはならない)。MCID の付いたものどうしは入れ子にしない。
  - `q`〜`Q` と marked content は、きちんと入れ子にする (印を変える前に、開いている `q` の中で始めた marked content を閉じる)。
- Form XObject:
  - 同じ SVG の使い回し (`recordVector`): ページの内容の流れの `Do` を、図の構造の節の marked content で包む。Form の中には MCID を付けない (図は全体が 1 つの Figure)。
  - 不透明度のグループ (`PdfPainter.group`) と、透明を平らにする出力の Form: 中に字や構造の違う中身が入るので、Form に `/StructParents` (ParentTree の鍵) を付け、Form の中の MCID を、MCR の `/Stm` (Form) と `/Pg` で指す (§14.7.4.2)。
  - 色つきの字形の Type3・Form (`src/colorGlyphPdf.ts`) は、字の marked content の中で使うので、中に印は要らない。
- 書き出しの終わり (`renderPdfPages`):
  - 構造の節ごとに StructElem を作る (中身の無い節は捨て、子を親に上げる)。`K` は、子の StructElem・MCID (同じページなら整数、`Pg` が違えば MCR の辞書)・OBJR の並び。
  - ページに `/StructParents i`、ParentTree (数の木) の `i` に「MCID の順の StructElem の並び」、注釈・Form の鍵に StructElem。`ParentTreeNextKey`。
  - StructTreeRoot に `K` (Document)・`ParentTree`・`RoleMap` (独自の型だけ)・`IDTree` (ID を付けた節があるとき)。
  - カタログに `/MarkInfo <</Marked true>>`、`/Lang`、PDF/UA では `/ViewerPreferences <</DisplayDocTitle true>>` と XMP (`dc:title`・`pdfuaid:part 1`)。XMP は `src/pdfStandard.ts` の PDF/X-4 の XMP の書き方を使い回す (PDF/A と同じ所で書く。3.7)。
- 試作で、pdf-lib の命令 (`PDFOperator.of('BDC', [PDFName.of('P'), ctx.obj({ MCID: 0 })])`) と、手で組んだ StructTreeRoot・ParentTree を書いた PDF を、Poppler の `pdfinfo -struct-text` が `Document > H1・P` と読み、`Tagged: yes` になることを確かめた (使い捨てのスクリプト。リポジトリには入れていない)。

### 3.7 選択肢と既定、PDF/X・PDF/A との組み合わせ

- 名前:
  - Node のコマンド: `--tagged` (タグ付き PDF)、`--pdfua` (PDF/UA-1。`--tagged` を含み、版の印・DisplayDocTitle・XMP を書き、足りないもの (題・言語・図の代わりの文・見出しの跳び) を警告に出す)。
    `--lang` は文言の言語の指定 (既存) なので、文書の言語の上書きは `--document-lang <BCP 47>` にする (入力に言語が無いとき用)。
  - API: `PdfOptions` に `tagged?: boolean` と `pdfua?: boolean` (PDF/X の `pdfx` と並べる)。`typesetToPdf` も同じ。
  - 画面 (`index.html`): PDF の保存の設定に「タグ付き PDF」と「PDF/UA-1」のチェック。
- 既定: 当面は「タグ無し」を既定にする (段階 1〜3 の間は、型の対応と Artifact の決まりが揃っていないので、半端なタグは、無いよりも読み上げを乱すことがある)。
  段階 4 を終え、見本の文書で veraPDF の PDF/UA-1 の検査を通るようになったら、タグ付きを既定にするかを決め直す (大きさ・速さの影響は 3.8 のとおり小さい)。
- PDF/X との組み合わせ:
  - PDF/X-4 (PDF 1.6 が元): `--tagged`・`--pdfua` と組み合わせられる。XMP に pdfxid と pdfuaid の両方を書く。
  - PDF/X-1a・X-3 (PDF 1.3・1.4 が元): 構造の木 (PDF 1.3) は書けるが、Ruby・Warichu などの型 (PDF 1.5) と PDF/UA-1 (ISO 32000-1 が元) は版に合わない。
    `--tagged` は、版に無い型を RoleMap で Span などに写して書き、`--pdfua` との組み合わせは使えない誤りにする。透明を平らにして画像にした所は、元の構造の節の中身として包む。
- PDF/A (別のセッションで進めている PDF/A の対応) との組み合わせ: PDF/A-1a・2a・3a は、タグ付き PDF が前提 (水準 a)。PDF/A-2u・3u と PDF/UA-1 を一緒に書くことが多い。
  XMP の書き方 (pdfaid・pdfuaid・pdfxid と dc:title) を 1 か所にまとめ、どちらの変更も同じ所に足す。どちらを先に入れても、後から入れるほうが合わせる。

### 3.8 大きさ・速さへの影響の見積もり

- 構造の節の数は、入力の要素の数ほど (透明の節を除く)。StructElem 1 つは、圧縮前で 80〜150 バイトほど (`/S /P /K /Pg` と ID・属性)。
  例: 300 ページの本で段落・見出し・リストの項目・セルが 2 万 → 圧縮前 2〜3MB、オブジェクトストリームと Flate で 0.4〜0.8MB ほど。
- 内容の流れ: marked content 1 つで 20〜30 バイト (`/P <</MCID 12>> BDC` と `EMC`)、印が変わるたびの BT〜ET の閉じと開き。Flate で小さくなる。
  背景・罫線を Artifact で包む分は、同じ印が続く間は 1 つにまとめる (隣り合う背景・罫線を 1 つの Artifact にする)。字の並びは、同じ構造の節が続く間は 1 つの MCID。
- 全体で、PDF の大きさは 5〜20% ほど増える見積もり (字の多い本は少なく、表・リスト・リンクの多い文書は多い)。実装の段 1 で、見本の文書で測って書き直す。
- 速さ: 構造の木を作るのは要素の数に比例。pdf-lib の物を作る手間は、2 万の StructElem で 100ms ほどの見積もり。
- 上限 (SECURITY.md の範囲):
  - 構造の木の深さは、入力の入れ子の上限 (HTML の `MAX_TREE_DEPTH`・XSL-FO の `MAX_FO_NEST`) で抑えられる。木をたどる所は明示のスタックにする (`paintArea` と同じ)。
  - ParentTree はページごとの並びなので、数はページの数ほど。ページの数が多い (1 万ページ以上) ときは、数の木を Kids に分ける。
  - 1 字ごとに MCID を作らない (同じ構造の節が続く間はまとめる) ので、MCID の数は「ページ × そのページの構造の節の数」で抑えられる。
  - `lowMemory` では、構造の節ごとの中身の項目 (ページと MCID の並び) を書き終えるまで持つ。メモリは構造の節の数に比例 (領域の木よりずっと小さい)。

### 3.9 確かめ方

- veraPDF (PDF/UA-1 の検査。無償):
  - この環境では、Java 21 があり、Maven Central から veraPDF の部品 (`org.verapdf.apps:greenfield-apps:1.28.2` と依存の 19 個の jar) を取れた (`mvn dependency:copy-dependencies`)。veraPDF の配布元 (software.verapdf.org) と GitHub のリリースは、ネットワークの決まりで止められた。
  - 動かすのは `java -cp "<jar のディレクトリ>/*" org.verapdf.apps.GreenfieldCliWrapper -f ua1 --format text <PDF>`。初めは自動の許可の判定で止められたが、利用者が veraPDF を動かすことを許した (2026-11-19) 後は動いた。
  - `scripts/verapdf.mjs` に、取るところから検査までをまとめた: `NODE_USE_ENV_PROXY=1 node scripts/verapdf.mjs --fetch-only` で、jar を Maven Central から `.cache/verapdf/1.28.2/` に取り (jar ごとに、スクリプトに書いた SHA-256 と比べる。429・5xx は間を空けて 4 回まで取り直す)、
    `node scripts/verapdf.mjs [--flavour ua1] <PDF>...` で、PDF ごとに、合うかと、落ちた規則 (節・検査の番号・か所の数・veraPDF の説明) を出す (`--raw` は veraPDF の文の報告)。合わない PDF があれば終わりの番号は 1、動かせなければ 2。
    CI の決まりには入れない (Java が要るので)。タグ付き PDF を変えたときに走らせ、結果をコミットの文と報告に書く (CLAUDE.md の「確かめ方」)。
- Poppler: `pdfinfo` (Tagged: yes)、`pdfinfo -struct`・`-struct-text` (構造の木と、節ごとの字)。この環境の Poppler 24.02 で使える。
- 単体の試験 (`test/`): 組んだ PDF を pdf-lib で読み直し、StructTreeRoot の木の型の並び・MCID と ParentTree の対応・Artifact で包んだ所・Alt・Lang・Scope・OBJR を確かめる。自前の検査 (`src/pdfxVerify.ts` と同じ形の `pdfuaVerify`) を `--pdfua` の書き出しの後に走らせ、足りないものを警告にする案もある。
- 見本の文書: アンテナハウスのサンプル FO 集・『CSSページ組版入門』を `--tagged` で組み、`pdfinfo -struct-text` の読む順を目で確かめる。組版の結果 (字・線の位置) は変わらないので、`scripts/compare-pdf.mjs` で見本と比べて、変わらないことを確かめる。

## 4. 段階に分けた実装の計画

1. **段階 1 (小さく): HTML の見出し・段落・リスト・図・リンク**
   - `LDocument.structure` と `tag` の欄、`AreaTree.structure` (版 4)、`Painter.tag`、`PdfPainter` の BDC/EMC、StructTreeRoot・ParentTree・MarkInfo・/Lang の書き出し。
   - HTML の Document・Div・Sect・Art・P・H1〜H6・L/LI/Lbl/LBody・Figure (Alt)・Link (OBJR・Tabs)・Span (lang)。背景・罫線・柱は Artifact。
   - `--tagged` と `PdfOptions.tagged`。既定はタグ無し。試験と `pdfinfo -struct-text` で確かめる。
   - **2026-11-19 に作った** (ブランチ `claude/out-51-tagged-pdf-stage1`)。設計からの違い・分かったこと:
     - Area に `tag` の欄を足さず、`AreaTree.structure.tags` (入力の節の番号 `sourceRef` → 構造の節の番号) で引く。読み込みが、構造を作らない包みの箱にも、中身の入る構造の節の番号を付けるので、組版の中で作る箱 (番号の無い箱) は、祖先の Area の番号で足りる。Area の形は変えていないので、版は 3 のまま。
     - API は `TypesetOptions.tagged` (読み込みで構造の木を作るので、`toPdf` の設定ではなく、組む前の設定にした)。
     - 行の中のリンクの範囲の箱は、行の字の後に置かれ、元の節の番号を持っていなかったので、リンクの inline の番号を付けた (注釈を Link の構造に結ぶため)。
     - 不透明度のグループ (Form XObject) は、中に印を書かず、置く命令 (Do) を、グループの箱の構造の印で包む (グループの中の構造は、その箱の構造に入る)。Form の中の MCID (`/Stm`) は段階 4。
     - PDF/X-1a・X-3 (透明を平らにする出力) との組み合わせは、平らにした所を後でまとめて描くので、段階 1 では誤りにした。
     - 表は、まだ表の構造にせず、セルの中の字を外の構造に入れる。繰り返した表の見出し・脚は、もう Pagination の Artifact にしている (表の構造は段階 2 で作った)。
     - 大きさ・速さ (146 ページ・構造の節 2,701 の、見出し・段落・リンク・リストだけの文書): 全体の時間は 4.5 秒 → 5.0 秒、PDF は 227KB → 337KB (+48%)。
       増えた分は、内容の流れ (印の BDC・EMC と、印の変わり目で閉じ直す BT〜ET) が圧縮後で +30KB (+21%)、構造の木 (StructElem と ParentTree) が約 80KB (StructElem 1 つで約 30 バイト)。
       元の PDF が 1 ページ 1.5KB と小さい文書なので割合が大きく、1 ページあたりでは約 750 バイト。3.8 の「5〜20%」は、書体・画像の大きい文書での割合で、字の少ない文書では大きくなる。
     - veraPDF 1.28.2 の PDF/UA-1 の検査で、試しの文書 (見出し・段落・リンク・リスト・図・表・英語の段落) の落ちる規則は、タグ無しの 11 から 2 (7.1 の 8: XMP の Metadata、7.1 の 10: DisplayDocTitle。どちらも段階 4 の `--pdfua`) になった。
2. **段階 2: 表と脚注** — Table・THead・TBody・TFoot・TR・TH・TD (Scope・Headers・RowSpan・ColSpan)、繰り返した見出しと脚を Artifact、ページをまたぐ表と段落の MCR、Note (ID)・Reference・脚注の区切りの線。
   - **2026-11-20 に作った** (ブランチ `claude/out-51-tagged-pdf-stage2`)。決めたこと・分かったこと:
     - 表の構造の型は、要素 (table・caption・thead・tbody・tfoot・tr・th・td) と ARIA の役 (table・grid・row・cell・columnheader・rowheader・rowgroup) で決め、CSS の `display` では決めない (HTML-AAM)。
       `display: table`・`grid` で並べた div は Div のまま、`role="presentation"`・`"none"` の表は、表の部分 (行・セル) も構造を作らない (WAI-ARIA 1.2 の、役を受け継ぐ子)。
     - TH の Scope: `scope` 属性 (row・rowgroup は Row、col・colgroup は Column)、ARIA の rowheader・columnheader、無ければ、thead の中か行のセルがみな th なら Column、ほかは Row。
       RowSpan・ColSpan は属性 (`rowspan="0"` は行のまとまりの残り)。`headers` 属性は、指すセルの構造の節の ID の並び (Headers) にし、指されたセルに要素の id を ID として付ける。
       ID のある節は StructTreeRoot の IDTree (名前の木。鍵はバイトの順) に入れる。ID は ASCII ならそのまま、ほかは UTF-8 のバイトの 16 進。同じ値の 2 つ目からは後ろに番号を足す。
     - 中身の無いセル・行も、使われた表の中なら書く (落とすと行と列の並びがずれる)。thead・tfoot のある表の、tbody に入っていない行 (読み込みの構文解析は tbody を補わない) は TBody に入れる (veraPDF の 7.2-14)。
     - 脚注 (`float: footnote`): 要素は Note (ID は要素の id か `note-<番号>`)。本文の参照の印は、その前に置く Reference、本体の頭の番号は Note の中の Lbl。
       組版が作る印と番号の字に構造の節を当てるため、`LFootnote.tagParts` に中身の無い入力の節 (call・label) を持たせ、その通し番号を、印の字 (inlineFlatten の atom の ref) と、番号を包む inline (layoutEngine の `footBlock`) に付ける。
       本体はページの下に描くので、描いた順では段落の終わりの後ろになる。構造の節に `anchor` (目印の節) を足し、親の中身の項目の間では、目印の節 (Reference) の最初の項目のすぐ後ろに置く。
       DPUB-ARIA の `doc-footnote`・`doc-endnote` は Note (書かれた所)、`doc-noteref` は Reference。XSL-FO の fo:footnote は段階 3。
     - 組版で、表と脚注の写しが入力の節の番号 (sourceRef) を引き継いでいなかった: 罫線を重ねる表 (`collapseTableBorders`)・中身で列の幅を決めた表・行の高さの直し・行をまたぐセルの分け方・表の見出し (caption)・脚注の本体 (`withLabel`・本体のブロック)。
       そのため、段階 1 では表のセルの字が外の構造に入り、脚注の本体の中のリンクが Link にならず (注釈に Contents が無い。veraPDF の 7.18.1-2・7.18.5-2)、本体の字が文書の直下に入っていた。写しに番号を引き継ぐようにした。
       タグ無しの PDF は、これで変わらないことを確かめた (HTML・XSL-FO の対応仕様書、CSS-Print、表・脚注を含むサンプル FO 41 個で、日付と ID を固定して main とバイト列が同じ)。
     - 段階 1 の残り: 構造の節の文書の順 (`orderOf`) を、`getElementsByTagName('*')` の添字で引いていて、linkedom では要素の数の 2 乗の手間だった (HTML の対応仕様書で、タグ有りが 15 秒 → 22 秒)。前順に明示のスタックでたどるようにした (15.5 秒)。
     - 確かめ (veraPDF 1.28.2 の PDF/UA-1): 表 (見出し・結合・空のセル・tfoot・ページをまたぐ)・脚注の試しの文書は、落ちる規則が段階 4 の 2 つ (7.1-8 XMP・7.1-10 DisplayDocTitle) だけ。
       CSS-Print (`--style ah`) は、段階 1 の 6 規則 (7.18.1-2・7.18.5-2 の脚注の中のリンクを含む) から 3 規則 (7.1-8・7.1-10 と、7.3-1 の代わりの文の無い画像 12 か所。文書の側) に、HTML の対応仕様書は段階 1 と同じ 5 規則 (7.1-8・7.1-10 と、文書の側の 7.3-1・7.4.2-1・7.7-1)。表の規則 (7.2・7.5) では落ちない。
     - タグの有無でページの画像 (pdftoppm 50dpi) は、HTML の対応仕様書 124 ページで全ページ同じ。CSS-Print 142 ページでは、目次の 3 ページで、ノンブルの字の縁の数十の画素が違う (段階 1 から同じ)。
       タグ有りでは印の変わり目で字の並び (BT〜ET) を閉じ直し、続く字の位置を絶対の位置で書くので、続けて相対で送るタグ無しと、位置が 0.00003pt ほど違い、画素の境目の塗りが変わるため (pdftotext の位置で確かめた)。組版の結果は同じ。
     - 大きさ・速さ: HTML の対応仕様書 (124 ページ) は 1,348KB → 1,542KB (+14%)、15.0 秒 → 15.5 秒。CSS-Print (142 ページ) は 4,432KB → 4,615KB (+4%)、15.7 秒 → 16.1 秒。
3. **段階 3: XSL-FO** — fo: の要素の対応、`role` の読み、static-content の Artifact (Header・Footer)、fo:leader、fo:float、アンテナハウスの拡張の代わりの文。
   - **2026-11-20 に作った** (ブランチ `claude/out-51-tagged-pdf-stage3`)。決めたこと・分かったこと:
     - 構造の木を作る仕組みを `src/structureBuilder.ts` (StructureBuilder) にまとめ、HTML と XSL-FO の読み込みで共通に使う (要素の木の形と、要素ごとの型の決め方だけを読み込みが渡す)。
       HTML の構造の木は、まとめる前と同じ (試験と、対応仕様書・CSS-Print のタグ付きの PDF で確かめた)。
     - 要素の対応は 3.3 の表のとおり。fo:block は、子に空白でない字か行の中の要素があれば P、ブロックだけなら Div。fo:list-item の子 (label・body) は、自分で Lbl・LBody になる
       (HTML の li のように中身を LBody に入れない)。表の要素の無い行 (starts-row・ends-row で分けたセルの並び) は、TR を作ってセルを入れる。
       fo:footnote-body は Note (ID は fo:footnote-body か fo:footnote の id)、参照の印は Reference。本体の頭の番号は、本体の中に書いたもの (組版は番号を付けない) なので Lbl は作らない。
       Header・Footer の Subtype はまだ書かない (Pagination だけ)。
     - 言語: 要素の `xml:lang` か `language` (と `country`) が、親の要素の言語と違うときだけ、その構造の節の Lang。行の中の要素は、そのときだけ Span を作る。
       文書の言語 (カタログの Lang) は fo:root の言語、無ければ最初の fo:page-sequence の言語。
     - `role`: 値が標準の構造の型の名前なら、その型。ほかの名前は独自の型として書き、RoleMap で既定の型に写す (§14.7.3)。
       アンテナハウスの拡張は、公開の説明 (オンラインマニュアルの「PDF出力」のタグ付きPDF・「拡張仕様」) で確かめて、`axf:pdftag` (型の名前。Artifact は飾り、空 (`''`) は構造を作らない)・
       `axf:alttext` (図・リンクの代わりの文)・`axf:expansion-text` (略語の展開) を読む。アンテナハウスは `role` を型の名前にしない (`axf:pdftag` を使う) が、`role` は XSL 1.1 §7.5.2 の標準の性質なので、設計どおり読む。
     - 分かったこと・直したこと (HTML にも効く):
       - リーダー (fo:leader・CSS の `leader()`) の点の箱が、元の節の番号を持っておらず、点が段落の字として構造に入っていた。リーダーの節の番号を付け、飾りにした
         (CSS-Print の目次で、タグの有無で画素の違っていた 3 ページが、同じになった: リーダーの前後で字の並びを区切る所が、タグ無しと同じになったため)。
       - リンクでない注釈 (テキスト・スタンプ・添付ファイル・ポップアップ) を Annot の構造の節に入れる (ISO 14289-1 §7.18.1。Contents の無い注釈は、題を Alt に)。
       - 字の無いリンク (柱の中のリンクは飾りの字なので、Link の字として集めない) の Contents は、飛び先 (URI か `#id`)。
       - セルの足りない行 (行の終わりのセルを書かない表) の終わりに、中身の無い TD を足して、行ごとの列の数をそろえる (veraPDF の 7.2-43)。
     - 確かめ: タグ無しの PDF は、アンテナハウスのサンプル FO 216 個と XSL-FO の対応仕様書、HTML の対応仕様書、CSS-Print で main とバイト列が同じ。
       タグの有無でページの画像 (pdftoppm 40〜50dpi) は、サンプル FO 216 個・XSL-FO の対応仕様書 87 ページ・HTML の対応仕様書 124 ページ・CSS-Print 142 ページのどれも同じ。
       veraPDF 1.28.2 の PDF/UA-1: サンプル FO 216 個と XSL-FO の対応仕様書は、どれも 7.1-8・7.1-10 (段階 4) のほかに、文書の側か段階 4 のものだけ
       (7.3-1 代わりの文の無い図 38 文書、7.7-1 代わりの文の無い数式 4、7.18.4-1・7.18.1-3 フォームの欄 4、7.21.4.1-1・7.21.7-1・7.21.8-1 書体に字形の無い字 4)。
       注釈の規則 (7.18.1-1・7.18.1-2・7.18.5-2) と表の規則 (7.2-43) では落ちない。
     - 大きさ・速さ (タグ無し → タグ有り): XSL-FO の対応仕様書 (87 ページ) 790KB → 956KB、6.5 秒 → 6.6 秒。
4. **段階 4: PDF/UA-1** — `--pdfua` (XMP の pdfuaid・DisplayDocTitle・dc:title)、足りないものの警告、数式 (Formula)、ルビ (Ruby・RB・RT・RP)・割注 (Warichu)、Form XObject の中の MCID (不透明度のグループ)、フォームの欄、PDF/X-4・PDF/A との組み合わせ。veraPDF で見本の文書を検査する。
   - **2026-11-20 に作った** (ブランチ `claude/out-51-tagged-pdf-stage4`)。決めたこと・分かったこと:
     - API は `TypesetOptions.pdfua` (`true` か `{ warnings }`。tagged を含む) と `documentLang`、コマンドは `--pdfua`・`--document-lang`。PdfRenderOptions.pdfua。
       XMP は PDF/A・PDF/X と同じ所 (`markPdfStandard`) で書く: `pdfuaid:part` 1 と `dc:title`。PDF/A と合わせるときは pdfuaid を拡張のスキーマで定義する (PDF/X と合わせたときの XMP は変わらない)。
       ViewerPreferences の DisplayDocTitle。字形の無い字 (.notdef) は、PDF/A と同じ仕組みで描かずに警告する。
     - 足りないものは、構造の木から数えて警告にする (PDF は書く): 文書の題・言語、代わりの文の無い Figure・Formula、見出しの段の跳び (前順で、最初が H1、深くなるときは 1 段ずつ)。
       前順のために、pdfTags の構造の節をたどる順を、子を後ろから積む前順に直した (StructElem の物の番号の順が変わる)。
     - 不透明度のグループ (Form XObject) の中も印を書く: MCID は Form ごとに 0 から、構造の木からは MCR の Stm で Form を指し、Form に StructParents を付ける (§14.7.4.2・§14.7.4.4)。
       これまでのように Do を外の箱の印で包むと、グループの中の見出し・段落が構造に入らなかった。
     - 柱: 上の余白の箱と fo:region-before は Pagination の Subtype Header、下の余白の箱と fo:region-after は Footer (§14.8.2.2.2)。左右の余白の箱・fo:region-start・end と、running()・position: fixed は Subtype 無し。
     - ルビ: 親文字と注釈の組ごとに Ruby (RB・RT)。`LRuby.tagParts` の番号を、親文字の字とルビの字に付ける。rp は描かないので書かない。圏点の点は飾り (親文字はまわりの字のまま)。割注は、組版に割注の要素が無いので、まだ。
     - フォームの欄: 欄の注釈 (Widget) を Form の構造の節に入れ、欄に TU (説明か名前) を付ける。PDF/UA-1 では、欄の文字の見た目を埋め込んだ書体で描き、チェックボックス・ラジオボタンの印を ZapfDingbats でなく図形で描く (埋め込まない書体は使えない。§7.21.4.1)。
     - 確かめ: タグ無しの PDF は、サンプル FO 216 個・XSL-FO と HTML の対応仕様書・CSS-Print で main とバイト列が同じ。タグの有無の画像も、どれも同じ。
       veraPDF 1.28.2 の PDF/UA-1 (`--pdfua`): 試しの文書 (見出し・段落・表・脚注・リンク・リスト・図、不透明度の入れ子、ルビ・圏点、柱) は合格。
       サンプル FO 216 個と XSL-FO の対応仕様書は、どれも文書の題 (7.1-9) だけで落ちる (サンプルは `axf:document-info name="document-title"` で題を書くが、Kumiori は `title` だけを読む。下の 5 の決めること)。
       ほかは文書の側: 代わりの文の無い図 (7.3-1、40 文書)・数式 (7.7-1、5)、HTML の対応仕様書の見出しの段の跳び (7.4.2-1)。
     - Header・Footer、ルビ、Form XObject の中の MCID の 3 つは、タグ付き (--tagged) の出力にも効く。
5. **段階 5: 既定の見直し** — 大きさ・速さを見本の文書で測り、タグ付きを既定にするかを決める。画面の設定を足す。
   - **2026-11-20 に作った** (ブランチ `claude/out-51-tagged-pdf-stage5`)。利用者が、タグ付きを既定にすることに決めた (0.5.0 で切り替え)。
     - API の `tagged` の既定を true (false で外す)、コマンドは `--tagged` を既定にして `--no-tagged` で外す。画面は設定の引き出しに「タグ付き PDF にする」(既定でオン。ブラウザに覚える)。
       画面には英語の文言の仕組みが無いので、日本語だけ。
     - 透明を平らにする PDF/X-1a・X-3 では、既定のままならタグを付けない (PdfRenderOptions.tagged の 'auto'。typesetToPdf で pdfx が先に分かるときは、構造の木も作らない)。
       作成者が `--tagged`・`tagged: true` と書いたときは、これまでどおり誤り (頼まれたタグを黙って外さない)。`--pdfua` と X-1a・X-3、`--pdfua` と `--no-tagged` は誤り。
     - 確かめ: `--no-tagged` の出力は、変える前の既定の出力と、日付と ID を固定してバイト列で同じ (サンプル FO 216 個・XSL-FO と HTML の対応仕様書・CSS-Print)。
       PDF/X-1a・X-3 の既定の出力も、変える前と同じ (XSL-FO の対応仕様書・サンプル FO 40 個・CSS-Print)。typeset の後の toPdf で X-1a にしたときも、内容の流れはタグ無しと同じ。
       既定の出力を veraPDF の PDF/UA-1 にかけて、落ちる規則は段階 4 の --tagged と同じ (7.1-8・7.1-10 と、文書の側か書体のもの)。

## 5. 利用者が決めること

2026-11-19 に、利用者が 1〜6 のどれも (a) (おすすめ) に決めた。段階 1 から実装する。

1. 構造の木の持ち方: (a) 読み込みが別の構造の木を作り、箱に `tag` の番号を付ける (おすすめ。3.1) / (b) `sourceRef` から引く表だけにする (組版を変えないが、組版の中で作る箱が漏れる)。
2. 既定: (a) 当面はタグ無しを既定にし、段階 4 の後に決め直す (おすすめ) / (b) 段階 1 から既定をタグ付きにする。
3. 選択肢の名前: (a) `--tagged`・`--pdfua`・`--document-lang`、API の `tagged`・`pdfua` (おすすめ) / (b) `--pdf-profile ua1` のように 1 つにまとめる。
4. 進め方: (a) 段階 1 (HTML の見出し・段落・リスト・図・リンク) から始める (おすすめ) / (b) 段階 1〜2 (表・脚注まで) を 1 度に。
5. veraPDF の実行: (a) このセッションのような環境で veraPDF (Maven Central から取った jar) を動かすことを許す (おすすめ) / (b) veraPDF は手元で動かし、ここでは Poppler と単体の試験だけにする。
6. PDF/A との組み合わせ: (a) XMP を書く所を PDF/A の対応と 1 か所にまとめ、後から入れるほうが合わせる (おすすめ) / (b) PDF/A を先に入れ、そのあとでタグ付き PDF に取りかかる。
