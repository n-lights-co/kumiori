> English: [en/BACKLOG.md](en/BACKLOG.md)

# 未対応・既知の制限 (バックログ)

Kumiori にまだ無い機能・既知の制限の一覧。着手したら「状態」を更新し、完了したら「状態」を「完了」にする (行は履歴として残す)。
出典: 公開されている XSL-FO の見本での変換レポート、各機能の実装時メモ。仕様の項目ごとの対応・未対応は対応仕様説明書 (`docs/conformance/`) にある。

**いまも未対応・一部のもの (要約)**: PDF/X の規格 (ISO 15930) への適合の確認 (O-03)。CGM の GDP・POLYSYMBOL は、登録された中身が無いので描かない (I-09)。EPS (PostScript) の CCITTFaxDecode フィルタは持たない (I-03)。ほかに、状態が「ほぼ完了」「一部完了」の行にも残りがある。詳しくは各行のメモ。
優先度: **高** = 見本・実文書で頻出 / **中** = 時々出る / **低** = まれ・回避策あり。

## 組版エンジン

| ID | 項目 | 優先度 | 状態 | メモ |
|----|------|--------|------|------|
| E-01 | `keep-with-next` / `keep-with-previous` | 高 | 完了 | 並びの先頭が試し組みし、次のブロックの先頭が同じページに載らないときだけ改ページする。値は always と 1 以上の整数 (強さの違いは区別しない)。次が inline (字・画像) のときは、続く inline をまとめた無名のブロックの先頭と同じページに置く。表の keep は S-08。段 (column) 単位の判定は未対応 |
| E-02 | `text-align-last` | 高 | 完了 | start / center / end / justify。`relative` と未指定は従来どおり |
| E-03 | 罫線の種類 (点線・破線・二重線) | 高 | 完了 | dotted / dashed / double / groove / ridge / inset / outset (立体の罫線と色の違う実線の角は斜めに突き合わせる。破線・点線の模様 (線と間の長さ) は罫線の太さから決める) |
| E-04 | 下線・取り消し線 (`text-decoration`) | 中 | 完了 | `TextStyle.textDecoration` (underline / overline / line-through と no-*)。縦書きは下線が行の左。inline の罫線 (文字を囲む枠) は `inlineFlatten.ts` で組む (行をまたぐときは、切れ目の側の罫線を描かない) |
| E-05 | `baseline-shift` を行の高さ・行間に反映 | 低 | 完了 | super / sub / 長さ。ずらした字の行の高さの領域 (字の上下 + その字の line-height による半行間) をずらして、行からはみ出す分だけ行を広げる (line-height-shift-adjustment="consider-shifts"。半行間まで含めるので、上付き・下付きの行はずらした量だけ広がる) |
| E-06 | マージン領域へ張り出す float (`marginal-notes-*`) | 中 | 完了 | 傍注: 負の start/end-indent で余白へはみ出す float は、本文に食い込ませずに余白へ置く (`LFloat.marginal`)。float の inside / outside はページの偶奇で決め、次ページへ送られたら組み直す。ついでに page master / region-body の margin の略記 (2〜4 値) を修正 |
| E-07 | ページごとの脚注番号リセット | 中 | 完了 | `FootnoteOptions.reset: 'page'` (axf:footnote-number-reset="page")。前回の組版で脚注が置かれたページの中の順番で振り直し、置き場所が変わらなくなるまで組み直す。自動脚注番号の拡張 (axf:footnote-number / -citation / -format / -initial) にも対応 |
| E-08 | 脚注: 表・コンテナ内の脚注本体の出力 | 中 | 完了 | セル・ブロックコンテナ・float の中の行が脚注を持ち、親がその箱をページに置いたときに、そのページの脚注領域へ積む (繰り返す表の見出しの脚注は 1 度だけ)。行が入るかの判定には脚注の高さを含めない (入らなければ脚注を分割・次ページへ) |
| E-09 | 脚注: 複数ページにまたがる入れ子ブロックを含む脚注の分割 | 低 | 完了 | 入れ子のブロックの中まで降りて行で分ける (分けたブロックは切れ目の側の罫線・余白を落とす) |
| E-10 | 段組: ブロックコンテナ内の段組 (`axf:column-count`) | 中 | 完了 | `LBlockContainer.columns` (axf:column-count / column-gap / column-rule-* / column-rule-display)。高さの指定があれば段を順に埋め、無ければ段の高さを釣り合わせる。高さの指定・枠・回転の無いコンテナは、ページに収まらなければページをまたいで段を続ける (`layoutColumnsPaged`)。それ以外のコンテナはページをまたがない (中の脚注の本体は出さない) |
| E-11 | 段組: 段罫 (`axf:column-rule`) | 低 | 完了 | `PageMaster.columns.rule` (axf:column-rule-width/style/color) |
| E-12 | 段組: 前方 float・脚注を全段を貫く領域に置く | 高 | 完了 | 既定はページ単位 (全幅)。`axf:footnote-position="column"` で段ごと。float は span="all" の見出しの下ではなくページ上端に置く |
| E-13 | 段組: フロー末尾の段の釣り合わせ指定 | 低 | 完了 | `PageMaster.columns.fill: 'balance'` (region-body の `axf:column-fill` / `column-fill="balance"`) でフローの末尾の段も釣り合わせる。既定は span の直前だけ |
| E-14 | 条件付きページマスター間で inline 方向サイズが違う場合の再組版 | 低 | 完了 | 改ページで本文の幅が変わったら、開いている箱の幅を求め直し、段落の続きを新しい幅で 1 行ずつ組み直す (幅の指定がある箱・表の列幅はそのまま) |
| E-15 | 表: 行内分割・`border-collapse`・`table-footer` の繰り返し | 中 | ほぼ完了 | 行の分割 (ページに入らない行はセルの中身を行単位で分ける。keep-together の行は送る)、table-footer の繰り返し、table-omit-header/footer-at-break。border-collapse は S-01。自動の列幅 (幅の指定の無い表) は、入りきらなければ各列の最大の長さの比で配る (XSL-FO)。rowSpan を含む行の塊は、1 ページに入れば分けずに送り、入らなければ、またぐセルを行ごとのセルに分けて (中身は最初の行、間の罫線は消す) 行の境目でページをまたぐ (またぐセルの中身そのものを途中で分けることはしない) |
| E-16 | 親と直交する書字方向ブロックの頁分割 | 低 | 完了 | inline 方向の寸法の指定が無いブロック (横書きの中の縦書きなど): 行の長さをページの残りの高さにし、親の幅まで行を積んで、入りきらない行は次ページの断片へ続ける。寸法の指定があるもの・ブロックコンテナは従来どおり分割しない |
| E-17 | 約物の連続ツメ・ルビのオーバーハング・和欧間アキ・カーニング | 中 | 完了 | 約物の連続の詰め (」「・。」・（「) と和欧間アキ (四分)、ルビのはみ出し (`rubyOverhang`。前後の仮名・約物にルビ文字 1 字分まで。行頭・行末と漢字には掛けない)、ペアカーニング (`kerning`。横書きの欧文、フォントの kern / GPOS)。互換モードの既定は詰め・アキ・はみ出しがオン、カーニングはオフ |
| E-18 | 禁則: 行頭に立てられない約物の長い連続 | 低 | 完了 | 戻れる分割点が無いときは、先の分割点 (12 字以内) までを、行内の約物のアキ (全角の括弧・句読点の半分) を詰めて押し込む (追い込み)。詰めても入らなければ従来どおり強制分割 |
| E-19 | `float` の入れ子ブロック基準の位置、親と異なる書字方向の float | 低 | 完了 | 親と直交する書字方向の float は、自身の書字方向で組んで端に置き、物理の大きさで本文を回り込ませる (行の長さの既定は、CSS (HTML) の float では使える長さの中の fit-content (CSS Writing Modes 3 §7.3)、XSL-FO の float ではページの残り)。位置は参照領域 (本文領域・ブロックコンテナ) の端が基準で、仕様どおり入れ子のブロックの端ではない |
| E-20 | `marker` の `last-ending-within-page` | 低 | 完了 | XSL 1.1 §6.13.6・§7.25.4 どおり: そのページで終わる親の marker の最後、無ければそのページに断片のある親の marker の最後、それも無ければ持ち越し。block-container などの別の流れの中の親の終わりは記録しない (そのページの最後の marker として扱う) |

## XSL-FO インポート

| ID | 項目 | 優先度 | 状態 | メモ |
|----|------|--------|------|------|
| I-01 | `page-sequence` の数値の `reference-orientation`、90 の倍数以外 | 低 | 完了 | page-sequence の数値は本文 (region-body) の向きを上書きする (from-page-master-region() は region-body の指定)。90 の倍数以外は仕様で許されない値なので、0 として報告する |
| I-02 | `fo:instream-foreign-object` (インライン SVG・MathML) | 中 | ほぼ完了 | SVG は data URI の画像 (PDF はベクタ)。MathML (Presentation) は行内の要素に組み替える (上付き・下付き・分数・根号・上下の添え字・mfenced・mtable は行を積む)。CDATA に入った MathML・SVG も読む。伸縮する括弧は中身の高さの見積もりで図形を描く (見積もりなので、実際の高さと少しずれることがある)。アクセントの矢印・根号も図形と罫線で描く。表 (mtable) は列の揃え (columnalign)・行の間隔 (rowspacing。ex の単位も読む) に対応し、式の全体が表なら表の下端を文字の下端に揃える。揃えの記号 (maligngroup)・式番号 (mlabeledtr) を行の端に寄せる配置・Content MathML は未対応 (Content MathML は中の字を並べる)。ここまでは数式の書体が読めないときの後備 (`foMathFallback.ts`) のことで、数式の書体 (STIX Two Math) で組むとき (`mathLayout.ts`) は、maligngroup・mlabeledtr・Content MathML にも対応する。画像の枠 (width / height) の中の揃え (display-align / text-align) にも対応 |
| I-03 | WMF / EMF / EPS 画像 | 低 | 完了 | WMF・EMF は SVG にして描く (切り抜き・世界変換・弧・DIB・ALPHABLEND・パレット・模様のブラシ、描き先と混ぜるラスター演算は白黒の元なら描画モードで。ハッチは利用者の指定の 8 画素間隔)。EPS は PostScript を実行して SVG にする (図形・画像・色・文字。文字は埋め込まれた書体の字の形: Type 1・Type 3・CIDFontType 0・CFF)。網かけ (shfill・PatternType 2。ShadingType 1〜7、FunctionType 0・2・3 と手続き) は画素の画像、並べる模様 (PatternType 1) は PaintProc の絵の写しで描く。模様の線 (Pattern の色空間で stroke) は、線の輪郭 (太さ・端の形・つなぎ・破線・miter の上限を反映した形) を求めて、その形を模様で塗る。網かけ・関数・並べる模様は、定義が PDF と共通なので ISO 32000-2:2020 の §7.10・§8.7.3・§8.7.4 の本文で確かめた (標本の関数の Order 3 は、入力が 1 つで標本が 4 つ以上なら 3 次の自然スプライン、ほかは 1 次の補間)。**残り**: フィルタの CCITTFaxDecode (ファクシミリの符号。PLRM §3.13.3) は持たない (filter 演算子は undefined のエラーになり、そこまでに描いたものを描く)。書き出し用のフィルタも NullEncode のほかは持たない |
| I-04 | `axf:*` 拡張 (背景画像・フォーム・行番号・注釈など) | 中 | 完了 | axf:document-info、しおり、背景画像、段罫、リンク (fo:basic-link)、注釈 (Text・FreeText・Stamp)、行番号 (axf:line-number-*)、角丸 (axf:border-radius。四隅共通) と影 (axf:box-shadow。ずれ・ぼかし・広がり・色) に対応。改訂バー (axf:revision-bar-*)、対角罫・逆対角罫 (axf:diagonal-border-* / axf:reverse-diagonal-border-*)、フォーム (axf:form / axf:form-field。PDF の AcroForm の欄) にも対応。隅ごとの角丸 (axf:border-top-left-radius など) と listbox の top-index (axf:field-top-index) にも対応。添付ファイルの注釈 (axf:annotation-type="FileAttachment"。axf:annotation-file-attachment のファイルを PDF に埋め込み、axf:annotation-icon-name の印。ISO 32000-2 §12.5.6.15・§7.11.4)、プッシュボタンの指を乗せた時 (R) と押した時 (D) の見た目 (§12.5.5) にも対応 |
| I-05 | `fo:footnote-separator` 内の leader 以外 (テキスト・画像) | 低 | 完了 | 文字・画像 (external-graphic / instream-foreign-object)・背景色・罫線を持つ区切りは、内容として脚注領域の幅で組む。leader だけのものも同じ (leader を本文の中と同じに組む。実線・点線・長さ・太さ)。中身が空の区切りは既定の区切り線 |
| I-06 | `font-stretch` | 低 | 完了 | `TextStyle.fontStretch` (キーワードは CSS の比率、百分率、wider / narrower)。幅の違う書体 (`--font` / `fonts` の書体の usWidthClass、`@font-face` の `font-stretch` の記述子) があればその書体を選び (CSS Fonts 4 §5.2)、無ければ横書きの字形を水平に拡縮する (縦書きは変えない) |
| I-07 | MS 明朝 / MS ゴシックなど指定書体の実体 | 中 | 完了 (読み込み方式) | 画面の「書体を読み込む」で TTF / OTF / TTC を選ぶ。同梱はしない。太字は、書体に太字が無いと擬似太字 (字の輪郭を太らせる) で描く。OpenType の CFF 書体 (OTF) は、使わない字の字形を空にした部分書体で埋め込む (CID と GID の違う CID 方式の書体も、poppler で元の書体と同じ絵になることを確かめた) |
| I-08 | ルビ以外の `inline-container` の細かい挙動 | 低 | 完了 | shrink-to-fit・最初の行の基線揃えに加え、display-align (固定の高さの中の配置)・overflow="hidden" の切り抜き・alignment-baseline (central / before-edge / after-edge) に対応 (横書きの行) |
| I-09 | CGM 画像のまだ描かない要素 | 低 | 完了 | ISO/IEC 8632-1:1999 (正誤表 1・2 を含む) と 8632-3:1999 の本文で照らし合わせ済み。CELL ARRAY (局所の色の精度・詰めた並びと連なり・TRANSPARENT CELL COLOUR)、タイルの並び (TILE・BITONAL TILE。圧縮なし・連なり・T.4・T.6)、HYPERBOLIC / PARABOLIC ARC、NON-UNIFORM (RATIONAL) B-SPLINE、CONNECTING EDGE、模様 (PATTERN TABLE・PATTERN SIZE)、geometric pattern、三角形の INTERPOLATED INTERIOR (画素で塗る)、HATCH STYLE DEFINITION、LINE AND EDGE TYPE DEFINITION、TEXT PATH (left・up・down)、セグメント (BEGIN / END SEGMENT・COPY SEGMENT・SEGMENT TRANSFORMATION) に対応。第 3 版・第 4 版の要素: 束ね (LINE / MARKER / TEXT / FILL / EDGE REPRESENTATION と ASPECT SOURCE FLAGS。表に無い番号は個別の値)、INHERITANCE FILTER (state list の属性は COPY SEGMENT の時の値)、色の形 CIELAB・CIELUV・RGB-related (COLOUR VALUE EXTENT の倍率とずれ、COLOUR CALIBRATION の基準の白)、文字の集合 (CHARACTER SET LIST・CHARACTER CODING ANNOUNCER・CHARACTER SET INDEX・ALTERNATE CHARACTER SET INDEX。ISO 2022 の指示、JIS X 0208・JIS X 0201・GB 2312・KS C 5601・ISO/IEC 8859・UTF-8 など)、COMPOUND LINE、COMPOUND TEXT PATH と GENERALIZED TEXT PATH MODE (non-tangential・axis-tangential)、TEXT SCORE TYPE (右・左・中の線と圏点)、RESTRICTED TEXT TYPE (boxed-cap・boxed-all・isotropic-cap・isotropic-all・justified)、LINE / EDGE TYPE CONTINUATION (continue・restart・adaptive continue)・INITIAL OFFSET、MITRE LIMIT にも対応。TEXT ALIGNMENT の縦の揃え (top・cap・half・bottom・continuous) の向きを直した。登録簿 (ISO International Register of Graphical Items) の要素のうち、ESCAPE 22 (Transparent Cell Colour)・45 (Alpha Transparency。後の図形の不透明度)、色の型 6・7・8 (RGB-alpha・sRGB・sRGB-alpha。alpha の成分は塗り・線などの不透明度)、TILE の圧縮の形 7・8・9 (baseline JPEG・LZW・PNG の deflate と PNG のフィルタ) に対応 (ESCAPE のデータの記録は SDR として読む。番号は WebCGM 2.1 の表と規格の注で確かめた。登録簿そのものは読めていない)。描かないもの: GENERALIZED DRAWING PRIMITIVE (中身は登録簿で決まるが、登録された GDP が無い)・POLYSYMBOL (記号の表はメタファイルの外のもので、形は規格に無く、登録された表も無い。記号の属性は読む)・ほかの ESCAPE。LINE CAP の triangle と dash cap は SVG に無いので butt で描く。BEGIN TILE ARRAY のセルの大きさは、規格の文 (VDC の 1 単位あたりのセルの数) のとおりに読む |
| I-10 | 索引 (`fo:index-*` の一式、`index-key`・`index-class` ほか。XSL 1.1 §6.10・§7.24) | 中 | 完了 | 鍵の付いた要素・範囲 (`fo:index-range-begin`〜`-end`) の置かれたページを集め、`fo:index-page-citation-list` の所にページ番号の並びを作る (重複の除去、続いた 3 ページ以上の範囲、`index-class`、3 つの `merge-*`、区切り・前後の字の差し替え、`page-number-treatment="link"`、`fo:folio-prefix`・`-suffix`)。ページ番号の参照と同じ組み直しで収束させる (決まらなければ上限で止めて警告)。HTML+CSS には索引の標準の仕組みが無いので XSL-FO だけ (組版の側の `LIndexPageCitationList`・`LDocument.indexEntries` は入力によらない)。残り: id を組版へ渡さない要素 (leader・page-number-citation・footnote など) の `index-key`、アンテナハウスの索引の拡張 (`axf:suppress-duplicate-page-number`・`axf:index-page-citation-range-f-suffix`・`-ff-suffix`) |
| I-11 | アンテナハウスのフロートの拡張 (`axf:float-x`・`axf:float-y`・`axf:float-reference`・`axf:float-move`・`axf:float` など) | 中 | 未着手 | `fo:float` の `float` の値 (before・start・end・left・right・inside・outside) だけを読む。ページ・段を基準に置く位置 (上下・中央・ノド・小口) と、置けないときの送り方 (`auto-move`・`auto-next` など) は読まず、未対応として件数に出す (属性の名前で報告する)。ページ・段を単位に置く回り込みという大きな機能 (HTM-32 の (3)。見本の axf-float-page-1・axf-table-float-move-1 はページ数が合わない)。HTML の `-ah-float-x` は、CSS の回り込みと同じ置き方になる値 (left・right・start・end と inside・outside。`-ah-float-y` が none のとき) だけ読む |

## XSL-FO 1.1 仕様との相違 (仕様レビュー)

XSL 1.1 勧告 (2006-12-05) の原文と照らし合わせて見つけた相違。§ は仕様の節番号。

| ID | 項目 | 優先度 | 状態 | メモ |
|----|------|--------|------|------|
| S-01 | 表の `border-collapse` (§7.28.3、初期値 collapse) | 高 | 完了 | `LTable.borderCollapse` (FO の既定は collapse)。隣接セルは右・下のセルへ、表に外枠がある辺は外枠へまとめる (`tableBorders.ts`)。改ページで繰り返す表ヘッダー・表フッターと、そのページの最初・最後の行の境目は、接する行どうしの線から選び直す (§6.7.3・§6.7.10) |
| S-02 | margin-top/bottom 由来の space は `.conditionality=retain` (§5.3.2) | 高 | 完了 | margin の block 方向の前側 → retainSpaceBefore。後側 → retainSpaceAfter (仕様モードだけ。互換モードはページの終わりで捨てる)。space-after.conditionality="retain" はどちらのモードでも読む。段落の最後の行は、残す余白まで入る場合だけ置く (入れ子の箱の後ろの余白は、段落の箱のものだけを数える) |
| S-03 | `line-height` の長さ・% は計算済みの長さで継承 (§7.16.4) | 高 | 完了 | `lineHeightPt` (長さのまま継承) |
| S-04 | writing-mode: `tb-lr` の取り違え、rl-tb・bt-*・lr/rl/tb、page master の書字方向によるリージョン配置 (§7.29.7, §6.4.15-18) | 中 | 完了 | tb-lr (vertical-lr)・略記 lr / rl / tb・ページの書字方向によるリージョンの配置、rl-tb と direction="rtl" (行を右から。欧文・数字の並びは左から右、表の列も右から) に対応。vertical-lr のルビは左側。双方向のテキストは UAX #9 で並べる (inline・block の unicode-bidi・direction も使う)。アラビア文字などのつながる字は、並びをまとめて書体の字形の置き換えで組む (横書き)。bt-lr・bt-rl・lr-bt・rl-bt・lr-alternating-*・lr-inverting-*・tb-lr-in-lr-pairs は、横・縦で組んだ後に軸を裏返して表す (block-container と page-sequence・region-body)。bt-* の横向きの欧文の字の向きは上から下のまま、tb-lr-in-lr-pairs の組は縦中横 (1em に収める)、裏返すコンテナはページをまたがない |
| S-05 | break-before/after の `column`、odd/even-page の白ページ、`force-page-count`、`initial-page-number` の auto-odd/auto-even (§7.20.2, §7.27.6-7) | 中 | 完了 | `BreakKind` (page・column・odd-page・even-page)。段組で page は残りの段を空けて次ページへ。白ページの挿入、`forcePageCount`、initialPageNumber の auto-odd/auto-even。表の break-before/after も対応 |
| S-06 | 空白処理: linefeed-treatment / white-space-treatment / white-space-collapse を独立に、`wrap-option`、タブ (§7.16.7-8, 12-13) | 高 | 完了 | `refineText`。white-space 略記 (pre / nowrap / normal)、wrap-option、ゼロ幅空白も対応 |
| S-07 | 参照領域を作る要素 (block-container 等) の中の indent (§5.3.2) | 中 | 一部完了 | 仕様モード (compat=spec) でだけ §5.3.2 どおり (中の要素がコンテナの start-indent を内容端から受け継ぐ)。互換モードは従来どおり (indent の付いたブロックの中のコンテナの組み方は未確認)。あわせて、コンテナの寸法は内容の寸法・位置は内容の端・高さ未指定のコンテナのページまたぎ・ipd.maximum・既定の text-align は start・ハイフンの後ろの改行・語間の詰め・行末の和欧間アキ・太字の欧文は Times 相当、の各点を直した |
| S-08 | keep-together を table-row / list-item / table / block-container に、keep の強さ、.within-line | 中 | 一部完了 | 表の行・リスト項目の keep-with-next/previous、表の keep-together と keep-with-next、inline の keep-together.within-line に対応。keep の強さ (整数の大小) は区別しない |
| S-09 | table-cell の `display-align` | 高 | 完了 | display-align は表 → 行グループ → 行 → セルの順に継承 |
| S-10 | `id` を inline・wrapper・list-item・table-cell などからも拾う | 中 | 完了 | inline・wrapper・表の行・セル・リスト項目・ブロックコンテナ・画像・inline-container の id。セル・コンテナの中の id は、置いた時点のページで記録 |
| S-11 | font-size キーワード (small = medium になっている)、線種だけ指定した罫線の太さ (medium と不一致)、text-align left/right を書字方向で解釈 | 高 | 完了 | font-size キーワードは medium から 1.2 倍ずつ、線種だけの罫線は medium (2.25pt)。left/right は lr-tb・縦書きでは start/end と同じなので変更なし (rl-tb は S-04) |
| S-12 | page-number の `format` (§7.26.1)、citation-last、last-ending-within-page、page-sequence-master の maximum-repeats・順序・blank、リージョンの overflow 切り抜き、provisional-label-separation、space の precedence (§4.3)、脚注参照の書式 | 低 | 完了 | ページ番号の format、citation-last、page-sequence-master の順序・maximum-repeats・blank-or-not-blank (段組のページの、偶奇合わせの白ページも)、overflow の切り抜き、label-end() の provisional-label-separation、space の precedence (§4.3.1)、脚注参照の書式、last-ending-within-page (E-20) に対応 |
| S-13 | 仕様の初期値と、互換モードの既定 (行送り 1.2・ぶら下げ。両端揃えは既定にしない) の切り替え | 中 | 完了 | `ImportOptions.compat` (antenna / spec)。画面の「仕様どおりの既定値で組む」 |

## 出力 (Canvas / PDF)

| ID | 項目 | 優先度 | 状態 | メモ |
|----|------|--------|------|------|
| O-01 | SVG: グラデーション・clipPath・mask・filter・text・use・クラス CSS | 中 | ほぼ完了 | 線形・円形グラデーション (塗り・線)、clipPath (userSpaceOnUse)、use / symbol、pattern (中身は単色のみ)、`<style>` の単純な選択子、text (字形の輪郭。x / y・tspan・text-anchor) に対応。入れ子の svg・symbol の viewBox・switch・dy の em・mask (ソフトマスク)、@font-face の読み飛ばしにも対応。marker・textPath にも対応。stop-opacity (ソフトマスク) にも対応。filter は、ブラウザでは SVG ごとラスタライズし、Node では影 (feDropShadow、feGaussianBlur + feOffset + feMerge) とぼかしを図形で近似する (PDF にはぼかしの命令が無いので、ベクタのままでは近似になる)。Node でそのほかの filter は仮の枠 |
| O-02 | SVG: `preserveAspectRatio` (PDF 側) | 低 | 完了 | PDF のベクタ出力で、既定 (xMidYMid meet)・9 通りの揃え・slice (はみ出しを切り抜く)・none (引き伸ばし) に対応。Canvas はブラウザの描画に任せる |
| O-03 | PDF: ICC プロファイル・PDF/X 出力 | 低 | ほぼ完了 | `PdfRenderOptions.pdfx`: PDF/X-3:2003 の印 (OutputIntent。既定の印刷条件は ICC 登録名 JC200103、CMYK の ICC プロファイルを渡せば埋め込む)・GTS_PDFXVersion・Trapped・ID・PDF 1.4・オブジェクトストリームなし。RGB の色 (字・塗り・線・グラデーション) と色のある画像は CMYK にする。CMYK の ICC プロファイルを渡せば、その BToA の表 (lut8Type・lut16Type・lutBToAType。相対的な測色の B2A1、無ければ B2A0・B2A2) で sRGB から変換する (ICC.1:2010 = ISO 15076-1)。プロファイルが無いか表が読めなければ、ISO 32000-2 §10.4.2.4 の式 (黒の生成と下色の除去を k そのものにしたもの) で変換する。灰色は DeviceGray のまま。透明を使っていれば (画像の透明度も) 警告。出力意図の辞書は ISO 32000-2 の §14.11.5 (Table 401) で確かめた。ISO 15930 (PDF/X) の本文は有料で手元に無く、PDF/X に特有の決まり (TrimBox と ArtBox の扱い、GTS_PDFXVersion の値など) と、規格への完全な適合は確かめていない |
| O-04 | 表示用 Canvas の `fontKerning='none'` 固定 | 低 | 仕様 | PDF との字幅一致のため。カーニングは組版側で字の送りに足す (`kerning`、E-17) ので、Canvas と PDF で同じ位置になる |
| O-05 | 可変フォント (OpenType Font Variations) | 中 | ほぼ完了 | 軸の値ごとの形 (実体) を静的な書体にして組む (`src/fontInstancer.ts`: gvar・HVAR / VVAR・MVAR・GPOS の値・FeatureVariations・cvar。輪郭が CFF2 の書体は `src/cff2Instancer.ts`: blend・vsindex を計算して、静的な CFF にする)。`font-weight` → wght、`font-stretch` → wdth、`font-style` → ital・slnt、`font-optical-sizing` → opsz、`font-variation-settings`、`@font-face` の範囲と `font-named-instance`。PDF には実体ごとに埋め込み、画面では実体をブラウザに登録して描く。残り: CFF2 の実体のヒント (書かない。差分を当てたステムの並べ直しと hintmask の付け替えが要る) と輪郭の重なりの除去、斜体の `@font-face` (italic と、0deg を含まない oblique。読み込まない)、幅の違う `@font-face` どうしの選び分け (`font-stretch` の照合。CSS Fonts 4 §5.2)、avar の version 2 |

## 検証・運用

| ID | 項目 | 優先度 | 状態 | メモ |
|----|------|--------|------|------|
| V-01 | 見本の PDF との自動比較 (画像差分) | 中 | 完了 | `scripts/compare-pdf.mjs`: FO と見本の PDF (`--ref`) を渡すと、Kumiori の PDF を作り、ページごとの画像の差とページ数を report.md / report.json に出す (見本はリポジトリに入れないので CI には載せない)。`scripts/compare-view.mjs` で、見本と Kumiori の出力を目で見比べるページ (並べる・重ねる・点滅・差) も作れる |
| V-02 | ブラウザでの E2E テスト (Playwright) を CI に追加 | 中 | 完了 | Playwright (`npm run e2e`、e2e/)。標準サンプルと XSL-FO の組版、Canvas と PDF のページ数、仕様モードの切り替えを確かめる。CI に e2e ジョブを追加 |
| V-03 | 脚注の点線 (dots) の大きさとピッチ | 低 | 完了 | 区切りの leader はブロックの行の中にフォントの字 (.) で置き、点の間隔は字の送り幅 (use-font-metrics)。脚注どうしの間に既定のアキを入れない。点の行は約 1.5pt 下にずれる |
| V-04 | 日本語組版の根拠を JIS X 4051 から JLREQ に置き換える | 中 | 完了 | W3C の JLREQ (日本語組版処理の要件。Group Note 2020-08-11。JIS X 4051 に基づく。https://www.w3.org/TR/jlreq/ ) を主な根拠にした。ソース・テスト・docs・対応仕様説明書の JIS X 4051 の節・表の引用を JLREQ の節に書き直し (分割禁止 §3.1.10・後置省略記号 A.13 cl-13・行頭禁則 §3.1.7 とその注・約物の詰め §3.1.4・ルビのはみ出し §3.3.8・行の調整 §3.8)、README の規格の一覧を「JLREQ (JIS X 4051 に基づく)」にした。§3.1.7 の注の緩め方は「々」も行頭に置いてよいとするが、Kumiori の axf:line-break="normal" は小書きの仮名・長音記号だけを許す (CSS Text の line-break: normal と同じ)。JLREQ は規格ではないので、JIS X 4051 そのものへの適合は確かめていない |
