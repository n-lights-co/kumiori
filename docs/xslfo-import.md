> English: [en/xslfo-import.md](en/xslfo-import.md)

# XSL-FO インポート

`src/xslfoImport.ts` は XSL-FO (1.0 / 1.1) を Kumiori の論理ツリー (JSON) へ変換する。
画面の「XSL-FO を読み込む」から FO ファイルを選ぶと、変換 → 組版 → プレビューまでを行い、
「JSON を保存」で変換結果の JSON を、「PDF としてダウンロード」で PDF を取り出せる。
変換できなかった要素・属性は **黙って捨てず**、種類ごとの件数を「変換レポート」に出す。

```ts
import { importXslFo, browserParse } from './xslfoImport';
const { document, report } = importXslFo(foText, browserParse, { bleedMm: 3, trimMarks: true });
// Node では @xmldom/xmldom の DOMParser を包んだ関数を第 2 引数に渡す (テストを参照)
```

## 変換表

| XSL-FO | Kumiori |
| --- | --- |
| `simple-page-master` | `PageMaster` (ページ余白 + `region-body` 余白を本文領域の余白に合算) |
| `region-before/after/start/end` + `static-content` | リージョンの矩形に置く絶対配置コンテナ (`staticContent`)。`region-name` に対応。`precedence` (before / after、既定 false) に従い、既定では start / end が上下端まで通り、before / after はその間に収まる (true なら逆) |
| `page-sequence-master` (single / repeatable / alternatives) | `masterAlternatives` (`page-position`, `odd-or-even`) と、マスターごとの `staticContent` |
| `page-sequence` / `flow` | `LPageSequence` / `LFlow` (`initial-page-number`, `writing-mode`) |
| `block`, `inline`, `wrapper`, `basic-link`, `character` | `LBlock`, `LInline`, 文字 |
| `inline-container` (小さい block + 親文字 block) | `LRuby` (inline-container で書いたルビ) |
| 上記以外の `inline-container` | `LInlineContainer` (行内の箱。中に block を持てる。shrink-to-fit、最初の行の基線揃え、`writing-mode` の違いも可) |
| `external-graphic` | `LImage` (`url()` の包みを外す、`content-width/height`、`scale-to-fit` は `width/height` を枠に縦横比を保つ)。画像データは `AssetStore` から |
| `instream-foreign-object` | SVG は単独の SVG 文書に書き戻して data URI の画像 (`LImage`) にする (画面はブラウザが描き、PDF はベクタのまま)。MathML は、数式の書体 (STIX Two Math。MathML のある文書のときだけ読み込む) があれば、その書体の OpenType の MATH 表の値で組み、字の輪郭の図形 (SVG) の画像にして、数式の基線を行の基線に合わせて置く (`src/mathLayout.ts`)。組み方は MathML Core の算法 (mo の伸ばし方・大きな演算子、mrow の字の間のアキ、mfrac・msqrt・mroot・msub・msup・msubsup・munder・mover・munderover・mmultiscripts、添え字の字の大きさ) に従い、演算子のプロパティは MathML Core の演算子辞書 (`src/mathOperators.ts`) で決める。MathML Core に無い要素 (mtable の属性・mlabeledtr・maligngroup・malignmark・mfenced・menclose・mstack・mlongdiv) と Content MathML (apply など。見た目の記法に置き換える) にも対応する。`<mo>-</mo>` はマイナス記号 (−) で組む。数式は 1 つの画像なので、行の途中では折り返さない。数式の書体を読めないときは、行内の要素 (上付き・下付き・分数や上下の添え字の箱・根号・mtable の行の積み重ね) に組み替えて本文の書体で組む。伸縮する括弧 (stretchy="false" 以外の ( ) [ ] { } | など) は、中身の高さを見積もって図形 (SVG) で伸ばす。アクセントの矢印 (→ など) は下の字の幅の細い図形、根号は上と左に罫線のある箱と左下のはねの図形、⎴ ⎵ は図形で描く。負の rowspacing は行を詰める。CDATA に入った MathML・SVG も読む。それ以外は指定サイズの灰色のプレースホルダ |
| `background-color` (block / inline / inline-container / table / row / cell / table-header・body・footer / block-container) | `backgroundColor` (ヘッダ・本体・フッタの背景は、背景の無いセルへ引き継ぐ) |
| `region-body` / `region-before・after・start・end` の `background-color` | 本文の背面に敷く絶対配置 (`layer: 'behind'`) |
| `reference-orientation` (block-container / inline-container / region-start・end・before・after / region-body) | 箱の回転 (`rotation`、反時計回り 0/90/180/270。`-90` などは正規化)。region-body は `PageMaster.bodyRotation` (本文を回転前の寸法で組み、描画時に回す) |
| `writing-mode` (block / block-container / inline-container / table / region-body / **各リージョン**) | `writingMode`。リージョンは自身の指定に従い (page-sequence の `from-page-master-region()` = リージョン側の指定)、指定が無ければ横書き。`display-align` (center / after) はリージョンの内容の block 方向の配置 (`blockAlign`) |
| `simple-page-master` の `axf:background-color` (ページ全体の背景) | `PageMaster.backgroundColor` (塗り足しまで届く) |
| `table-and-caption`, `table`, `table-header/body/footer`, `table-row/cell` | `LTable` (列幅の固定・比例・%、`number-columns/rows-spanned`、列定義が足りない場合は補う)。表の幅も列の幅も指定が無く `table-layout` が fixed でなければ、列の幅を中身に合わせる (`fitContent`)。入りきらなければ、中身の短い列は最大の長さのまま、残りの列には各列の最大の長さ (行幅で頭打ち) の比で配る (`fitContentRule: 'max-ratio'`。HTML は最小と最大の間を比例で配るブラウザの方式) |
| `list-block` / `list-item` | 「ラベル列 + 本体列」の枠なし表 (`provisional-distance-between-starts`) |
| `float` (start/end/left/right/before) | `LFloat`。置いた位置 (アンカー) は中身として扱い、回り込みだけを含むブロックの space-before と space-after を相殺しない (`anchorIsContent`) |
| `footnote` / `footnote-body` | `LFootnote` (参照記号のテキストをラベルに、本体は自前のラベルを持つとして `bodyLabel: false`) |
| `leader` | `LLeader` (dots / rule / space / use-content、`leader-length.*`) |
| `marker` / `retrieve-marker` | `LMarker` / `LRetrieveMarker` (`retrieve-position`, `retrieve-boundary`) |
| `change-bar-begin` / `change-bar-end` | 範囲の中の要素・文字の `changeBars` (`RevisionBar` の並び。`changeBar: true`) |
| `retrieve-table-marker` (表の header・footer の中) | `LRetrieveTableMarker` (`retrieve-position-within-table`, `retrieve-boundary-within-table`)。`fo:table-body` の子の `marker` は `LTableRow.bodyMarkers` |
| `page-number` / `page-number-citation` | `{pageNumber}` トークン / `LPageNumberCitation` (組版を繰り返して収束) |
| `index-key` / `index-range-begin`〜`-end` / `index-page-citation-list` | `LDocument.indexEntries` (`LIndexEntry`) / `LIndexPageCitationList` (索引のページ番号の並び。組版を繰り返して収束) |
| `block-container` | `LBlockContainer` (`absolute-position`, `top/left/right/bottom`。本文領域の原点を足してページ基準に変換)。`width`・`height`・`inline/block-progression-dimension` は内容の寸法 (枠・パディングは外側)、`top`・`left` などは内容の端の位置 (枠はその外へ出る)。`inline-progression-dimension.maximum` だけの指定は、領域の幅が上限を超えるとき上限の幅。高さの指定の無いコンテナ (回転・段組・切り抜き・直交する書字方向を除く) は、あふれたらページをまたいで続く |
| `space-before/after`, `margin-*`, `start/end-indent` | `margin` (indent は継承される絶対位置なので、親との差分を margin にする) |
| `padding*`, `border*` (shorthand と before/after/start/end を書字方向で物理辺へ) | `padding`, `border` (`thin/medium/thick` 対応) |
| `font-size` (em/% は継承値基準), `line-height` (長さは比へ), `font-weight`, `color`, `background-color`, `text-align`, `text-indent`, `letter-spacing`, `orphans/widows`, `keep-together`, `break-before/after` | 同名のスタイル |
| `rgb-icc(r,g,b,#CMYK,c,m,y,k)` | `cmyk(c,m,y,k)` (PDF では DeviceCMYK のまま) |
| `rgb-icc(r,g,b,#Separation,'名前',濃度)` | 特色の値 (`spotColors`、コマンドの `--spot-colors`) に名前があれば `spot(濃度,c,m,y,k,名前)` (PDF では Separation)。無ければ `rgb(r,g,b)` |

## 既定値と書体

FO で指定が無いときの値は、Kumiori の HTML の既定 (10pt・行送り 1.75・両端揃え・ぶら下げ組み) ではなく **XSL-FO の既定** を使う。既定値の流儀は `compat` (コマンドの `--compat`) で選ぶ: 仕様モード `spec` (既定) は XSL-FO 1.1 の初期値どおり (`font-size` = medium = 12pt・行送り 1.2・start・ぶら下げ無し)、互換モード `antenna` は AH Formatter 向けに書かれた文書も組めるようにするための既定値 (以下は互換モードの値)。
`fo:root` → `fo:page-sequence` の順に重ねる: `font-size` = 10pt (medium。XSL-FO の仕様では処理系依存)、`line-height` = 1.2 (normal の代用。10pt の行は 12pt、12pt の行は 14.4pt の行送り。和欧混在の行で字ごとに半行間を変えることはしない。`defaultLineHeight` で変更可)、`text-align` = start (XSL-FO の初期値と同じ。指定の無い段落は両端揃えにしない)、行末の 、。 はぶら下げない (`axf:hanging-punctuation` の初期値 none。`end` などで有効)。行の調整は、日本語組版処理の要件 (JLREQ。https://www.w3.org/TR/jlreq/) §3.8 に従う (互換モード・仕様モードとも): 行があふれるときは、追い出す前に、次の分割点までを詰めて行に収められるか試す (追込みを優先する。§3.8.2)。詰める順と限界は §3.8.3 のとおりで、欧文の語間 (空白の 1/3 まで) → 行末の終わり括弧類・読点類・句点類の後ろの二分アキ → 行末の中点類の前後の四分アキ → 行中の中点類の前後の四分アキ → 行中の始め括弧類の前・終わり括弧類と読点類の後ろの二分アキ → 和字と欧字・数字の間の四分アキ (八分まで)。行中の句点類の後ろのアキと、行頭の始め括弧類の前のアキは詰めない。和字どうしの字間 (ベタ組) は詰めない。互換モードでは、追込みで詰める量の合計 (語間・約物のアキ・和欧間のアキ) を 1 行に二分 (約物 1 つ分) までに限る (`lineSqueezeMax` = 0.5。たとえば、読点 2 つを詰めれば入る 1 字や、和欧間のアキを多くの所で少しずつ詰めれば入る 1 字は、追い込まずに次の行へ送り、読点 1 つで足りる分は追い込む。仕様モードでは JLREQ のとおり限らない)。
書体は、画面側で `mapFont` に与える規則で決める: 太字・ゴシック系・sans-serif は Noto Sans JP (Regular / Bold)、それ以外 (明朝・serif・未指定) は Noto Serif JP。
FO が指定する MS 明朝・MS ゴシックなどの書体は同梱できない (Microsoft の書体)。画面の「書体を読み込む」から、お使いの PC の書体ファイルを選ぶと使える (次節)。読み込まない場合は、欧文の字幅などが元の組版結果と少しずれる。

## 未対応 (レポートに件数を出す)

知らない要素 (`fo:*`・MathML・`instream-foreign-object` の中身)・知らないリージョン名、`reference-orientation` の 90 の倍数以外の値 (0 として組む)、長さの式の知らない関数、読めない色、`font-variant`・`word-spacing`・`font-stretch` の読めない値、`text-decoration`・`text-transform`・`baseline-shift` の読めない値、`overflow` の auto・visible 以外、`axf:punctuation-trim`・`axf:field-type`・`axf:field-checked-style`・`axf:field-font-size`・`axf:annotation-type`・`axf:annotation-flags` の知らない値、`axf:printer-marks` の画像、添付するファイルの無い FileAttachment の注釈 (テキスト注釈にする)。
数式の書体が読めないときの後備の組み方では、数式の細部 (Content MathML・maligngroup・mlabeledtr) は、件数には出さずに描けないまま (`BACKLOG.md` の I-02。数式の書体で組むときは対応する)。

未対応の一覧と優先度は [BACKLOG.md](BACKLOG.md) に記録している。

## 画像の読み込み

画面で「XSL-FO・画像を読み込む」から、**FO ファイルと画像ファイルを一緒に (複数選択で)** 選ぶ。FO 中の `src="url('img/a.png')"` は、ファイル名 (`a.png`) で突き合わせる。
`data:` URI と絶対 URL (CORS が許す場合) は自動で読み込む。見つからない画像は灰色の枠で表示し、変換レポートに一覧する。後から画像だけを選び足すと、組み直される。
対応形式は PNG / JPEG / GIF / BMP / SVG / WebP と、下の TIFF・WMF・EMF・EPS・CGM。PDF には PNG・JPEG をそのまま、GIF・BMP・WebP・TIFF は画素を復号して PNG に変換して埋め込む (ブラウザが開ける画像は、出力サイズ × 300dpi に描き直す)。SVG は図形のまま入れ、filter など図形にできないものは、ブラウザではラスタライズし、Node では影・ぼかしを近似する。

ブラウザが開けない形式も読む:

- **TIFF**: utif (MIT) で画素を読む (非圧縮・PackBits・LZW、RGB・CMYK・YCbCr・パレット)。読み取りの処理は、TIFF を読むときだけ読み込む。
  CCITT の符号 (Compression=2 の Modified Huffman、Compression=3 の T.4 の 1 次元・2 次元、Compression=4 の T.6) は、TIFF 6.0 Specification の Section 10・11 と ITU-T T.4 (07/96) の 4.1・4.2 から書いた `src/ccitt.ts` で読む (1 次元の符号表は TIFF 6.0 の Section 10 の表を写したもの。T.4 の表と同じことを確かめた。FillOrder=2、PhotometricInterpretation が BlackIsZero のときの白黒の入れ替えにも対応)。非圧縮の形 (T4Options・T6Options の bit 1。T.4 の Table 5/T.4) と、タイルに分けた画像 (TIFF 6.0 Section 15) にも対応する。
- **WMF・EMF**: 描画命令 (`src/metafile.ts`) を SVG にして描く。PDF にはベクタのまま入る。対応はペン・ブラシ・フォント、線・多角形・矩形・楕円・弧・弦・扇形・パス・文字、
  座標系 (window。EMF の世界変換)、切り抜き (矩形・領域・パス。RegionMode の組み合わせはすべて。パスを含む OR・XOR は多角形の演算 (`src/regionBool.ts`) で 1 つの形にする。
  SAVEDC・RESTOREDC で戻る)、領域の塗り、画素、画像 (DIB。RLE4・RLE8・JPEG・PNG、論理パレットの番号の DIB_PAL_COLORS・DIB_PAL_INDICES を含む)、
  EMR_ALPHABLEND (不透明度で重ねる)、模様のブラシ (DIB の模様。装置の 1 画素の大きさのタイルの pattern。EMF はヘッダの Device と Millimeters、WMF は写像モードから決める)。
  ラスター演算: 描き先に依らないものは色を計算して描く。描き先に依るもの (SRCAND・SRCPAINT・SRCINVERT・DSTINVERT など) は、元と型の色の成分が 0 か 255 なら、
  乗算・スクリーン・差の描画モード (SVG の mix-blend-mode、PDF の BM) の層で同じ結果にする。SRCAND のマスクと同じ所への SRCINVERT の組は、透明の部分を持つ画像 1 枚にする。
  描かないもの: 色の成分が 0・255 以外の元を描き先と混ぜる演算 (ビット演算は重ね方で表せない)、Bitmap16 の模様のブラシ (装置に依る形式で画素の色の決まりが無い)、
  写像モードから装置の画素の大きさが決まらない WMF の模様のブラシ、DEFAULT_PALETTE (装置に依る) の番号の DIB、EMF+。
  ハッチのブラシ (BS_HATCHED): 仕様書は模様の向きだけを決め、線の間隔の決まりが無い。利用者の指定により、装置の 8 画素ごとに太さ 1 画素の線を引く
  (模様のブラシと同じく、装置の画素の大きさが決まるときだけ。線の間は、背景のモードが OPAQUE で背景色があればその色、そうでなければ塗らない)。
  仕様書 ([MS-WMF]・[MS-EMF]) に値の決まりが無いので推し量らないもの: PS_DASH などの破線の長さ、背景色の初期値 (SETBKCOLOR が無いとき)、
  SETTEXTJUSTIFICATION の区切りの字。
- **EPS**: PostScript を実行して描く (`src/psInterp.ts`・`src/psFilters.ts`・`src/psGraphics.ts`・`src/eps.ts`。PostScript Language Reference 第 3 版と EPSF 3.0 の仕様から書いた)。
  塗り・線・クリップ・色空間 (DeviceGray・DeviceRGB・DeviceCMYK・Indexed・Separation・DeviceN。CIE ベースは成分をそのまま使う)・画像 (image・colorimage・imagemask・type 3・4)・フィルタ (ASCIIHex・ASCII85・RunLength・LZW・Flate・SubFile・ReusableStream。DCT は JPEG のまま) に対応。CCITTFaxDecode (ファクシミリの符号) のフィルタは未対応で、使うと PostScript の undefined のエラーになる (そこまでに描いたものは描く)。
  描いたものは SVG にし、PDF には図形のまま入れる。DeviceCMYK で決まる色は、PDF にも DeviceCMYK で入れる。
  文字は、埋め込まれた書体の字の形で描く (`src/psFonts.ts`。Adobe Type 1 Font Format から書いた): Type 1 の書体 (eexec・字形の命令の暗号・flex・seac)、
  Type 3 の書体 (BuildGlyph・BuildChar)、CMap と CIDFontType 0 による複合書体 (composefont・StartData・GlyphDirectory)、
  CFF の書体 (FontSetInit の StartData。FontType 2 と CID の CFF。`src/psCff.ts`。CFF と Type 2 の字形の仕様から書いた)。
  字の形を持たない書体 (埋め込まれていない書体) は、書体の名前から手持ちの書体の系統 (ゴシック・明朝・等幅) を選んで描く。
  網かけ (shfill と、PatternType 2 の模様。ShadingType 1〜7、関数は FunctionType 0・2・3 と手続き) は、塗る範囲を画素に分けた画像にして描く。並べる模様 (PatternType 1) は、PaintProc の絵を 1 度描いて覚え、XStep・YStep ずつずらした写しを塗るパスで切り抜いて並べる (PaintType 2 は塗るときの色で)。模様の線 (Pattern の色空間で stroke) は、線の輪郭 (太さ・端の形・つなぎ・破線を反映した形) を求めて、その形を模様で塗る。描けないものがあって、DOS 形式のプレビュー (TIFF・WMF) を持つ EPS は、プレビューで描く。
  `fo:instream-foreign-object` の中に直接書いた EPS (%!PS で始まる文字) も描く。
- **CGM** (2 進符号化): 要素を読んで SVG にする (`src/cgm.ts`。ISO/IEC 8632-1:1999 の機能仕様と 8632-3:1999 の 2 進符号化から書いた)。
  精度の要素 (整数・実数・VDC・色・番号)、METAFILE DEFAULTS REPLACEMENT、VDC EXTENT・SCALING MODE (metric なら mm の大きさ、abstract なら幅 400px)、
  色 (色番号と色表・直接色・COLOUR VALUE EXTENT・CMYK)、線・辺・塗り (hollow・solid・hatch・empty・INTERPOLATED INTERIOR の平行と楕円)、
  POLYLINE・DISJOINT POLYLINE・POLYMARKER・POLYGON・POLYGON SET・RECTANGLE・CIRCLE・円弧 (3 点・中心)・ELLIPSE・楕円弧・POLYBEZIER、
  TEXT・RESTRICTED TEXT・APPEND TEXT (書体は FONT LIST の PostScript の名前から系統を選ぶ)、CLIP RECTANGLE を描く。
  仕様が表示装置・処理系しだいとする値は次のとおり: 背景色は白、前景色は黒。scaled の線の太さの基準は 0.192pt。
  文字の大文字の高さは 0.72em とする。線種 2〜5 の線と隙間の長さは線の太さの倍数。RESTRICTED TEXT (basic) は、文字の高さを箱の高さまでに縮め、幅を超えるときだけ横に縮める。
  scaled・mm の線・辺の太さと印の大きさは、表示装置の上の大きさとして、絵を拡大縮小しても変えない (`vector-effect="non-scaling-stroke"`・`"non-scaling-size"`。PDF の描画で、絵を置く拡大率の逆数を掛ける。scaled の印の大きさの基準は 1.34pt)。fractional (表示面に対する割合) は絵と一緒に拡大縮小する。
  閉じた図形 (BEGIN FIGURE 〜 END FIGURE・NEW REGION) は、中の線・塗りの要素をつないで領域にし、END FIGURE で内側の塗り方に従って 1 つの塗りとして描き、辺は辺の属性で描く。
  CELL ARRAY・模様 (pattern)・ESCAPE 22・45 (透明度)・三角形の色の補間・TEXT PATH (left・up・down) も描く (`BACKLOG.md` の I-09)。まだ描かないもの: GDP・POLYSYMBOL・ほかの ESCAPE (登録された中身が無い)・最初より後の絵。
- **.svgz** (gzip の SVG) は展開して SVG として読む。

言語ごとの約物のアキ: `fo:declarations` の `axf:space-before-punctuation`・`axf:space-after-punctuation`・`axf:space-between-punctuation-and-digit`・`axf:space-between-digit-and-punctuation` (code・space・language) を読み、言語 (`xml:lang` / `language`) が合う文字列で、記号の前後に行内の余白でアキを入れる。space の百分率は字の大きさに対する割合、`thin` は 1/6em。記号の隣が空白なら入れない。

分綴: `hyphenate="true"` の欧文の語は、分綴の位置で行末にハイフンを付けて分ける。分綴の規則は hyphen (ISC、TeX のパターン) で、今は英語 (`xml:lang` / `language` が en・en-US・en-GB、指定が無ければ英語) ・ラテン語 (la)・ロシア語 (ru)・ウクライナ語 (uk)・現代ギリシャ語 (el。単調の綴り) だけ (ロシア語・ウクライナ語の文ではキリル文字、現代ギリシャ語の文ではギリシャ文字の語も分ける)。規則は分綴を使う文書を開いたときだけ読み込む。5 字未満の語は分けない。

描けない形式でも、大きさはファイルの先頭から読む (`src/imageInfo.ts`) ので、仮の枠は正しい寸法になる。`fo:external-graphic` の `border`・`padding`・`background-color` は、画像 (width / height の枠があれば枠) の外側に描く。

## 公開されている見本の FO での結果

公開されている XSL-FO の見本の `.fo` (見本そのものは同梱していない) を変換して組版した結果。
下の箇条書きは XSL-FO の読み込みを作った初期 (2026-10 末) の記録で、挙げた未対応・崩れはその後の PR で対応した (`BACKLOG.md` の E-01〜E-06・E-10〜E-13・I-01・I-03・I-08)。組んだ結果は、`scripts/compare-pdf.mjs` (`--ref` に見本の PDF のディレクトリ) で見本の PDF と見比べて確かめている (手順は README)。

初期の記録:

- **すべての見本で変換・組版とも成功** (例外なし)。
- 出現数が多い未対応: 実線以外の罫線、画像、`text-align-last`、`keep-with-next`、
  ルビ以外の `inline-container`、`font-style`、`baseline-shift`、段組。
- 目次 (`page-number-citation` + `leader`)、脚注、`float` (side / before)、`page-sequence-master` の左右切り替え、`marker` の見出し、
  表 (`rowspan` / `colspan`)、縦書き (`tb-rl`)、ルビは、見本どおりの構成で組めることを確認。
- 見た目が崩れる例: マージン領域へ張り出す `float` (`marginal-notes-*`)、`reference-orientation` による回転、段組。

## ラテン文字のフォールバック

Noto Serif/Sans JP のラテン字幅は Times/Arial より広く、Times/Arial の字幅を前提に作られた文書と改行位置がずれる。
そこで `FontManager.setLatinFallback()` により、ラテン文字 (U+0020–024F、§ ¨ ° ± ´ ¶ × ÷ を除く) だけを
Tinos (明朝系) / Arimo (ゴシック系) で計測・描画・PDF 埋め込みする。和文は従来どおり Noto JP。
FO が指定する MS 明朝 / MS ゴシック自体は未搭載のため、完全一致ではなく Times/Arial 互換幅となる。

## 脚注の区切り線

`xsl-footnote-separator` の `fo:static-content` の中身 (`fo:leader`・文字・画像・背景色や罫線のあるブロック) を、
そのまま脚注領域の幅で組んで区切りにする。`fo:leader` は本文の中と同じに組む: `leader-pattern="dots"` は書体の点の字を並べ、
`rule` は実線 (`rule-thickness` 反映)、`leader-length` の百分率は脚注領域の幅に対する割合。
`xsl-footnote-separator` の `fo:static-content` が無ければ、区切りを描かない。
あっても中身が空 (空のブロックだけなど) のときは、既定の実線 (本文幅の 1/3) を使い、読み込みの報告に書く。

## 段組

`fo:region-body` の `column-count` / `column-gap` は `PageMaster.columns` に、`fo:block` の `span="all"` は `LBlock.span` に変換する
(フロー直下のブロックだけ有効)。段は inline 方向に並び (縦書きでは上下)、段が埋まると次の段、最後の段が埋まると次のページへ流れる。
`span="all"` の直前の段は、最後のページの段の高さを二分探索で縮めながら試し組みして釣り合わせる。ただし span のブロックが改ページで始まる (または直前のブロックが改ページで終わる) ときは、直前のページの段は釣り合わせない。入れ子のブロックの `span="all"` を flow の直下へ出して効かせるのは互換モードだけ (仕様では flow の直下のブロックにだけ効く。§7.21.4)。
フローの末尾 (span の後ろが無いとき) の段は釣り合わせない。ブロックコンテナ内の段組 (`axf:column-count` / `axf:column-gap` / `axf:column-rule-*` / `axf:column-rule-display`) にも対応 (高さの指定があれば段を順に埋め、無ければ釣り合わせる)。


## SVG

`fo:external-graphic` の SVG は、PDF ではベクタ命令のまま埋め込む (path・基本図形・transform・塗り/線・不透明度・破線)。
線形・円形グラデーション (塗り・線。spreadMethod の repeat・reflect、焦点の円の半径 fr も。stop-opacity は、不透明度をグレーにした同じグラデーションの輝度のソフトマスク)、clipPath、use / symbol、pattern (タイリングパターン。中身は単色の塗り・線のみ)、`<style>` の規則 (要素名・.class・#id の単純な選択子)、text (読み込み済みの書体の字形の輪郭にする。PDF では、単色の塗りだけの字 (線・グラデーション・模様の無いもの) を、その書体を埋め込んだ PDF の文字として描く。ビューアの字の描き方 (ヒンティング) が本文と同じになり、文字として選べる。x / y・dx / dy (em も)・tspan・text-anchor・font-size / family / weight)、
入れ子の svg と viewBox のある symbol (枠に viewBox を preserveAspectRatio で合わせ、overflow が visible でなければ枠で切り抜く)、
switch (条件を満たす最初の子。requiredExtensions の付いた子は満たさない)、
marker (始点・途中・終点の頂点に置く。orient の auto・auto-start-reverse・角度、markerUnits、viewBox と refX / refY。overflow が visible・auto でなければ marker の枠で切り抜く。ただしコマンドの互換モード (`--compat antenna`) の XSL-FO では、overflow の指定が無い marker は切り抜かない)、
textPath (パスに沿って 1 字ずつ置き、その場所の向きに回す。startOffset・text-anchor)、
mask (中身を、マスクを使う要素の座標で図形にし、PDF では Form XObject の輝度のソフトマスクにする。マスクの領域 x・y・width・height は見ない。入れ子のマスクは内側だけが効く) もベクタのまま出力する。
`<style>` の @font-face・@import・@charset・@namespace は読み飛ばし、SVG でない名前空間の要素 (Visio の v:・Illustrator の i: など) は描かない。
filter・透明度などを含む模様・扱えない CSS 選択子を含む SVG は、従来どおり 300dpi でラスタライズする。
Node のコマンド (`dist-cli/cli.js`) ではラスタライズできないので、filter のうち影 (feDropShadow、feGaussianBlur + feOffset + feMerge。
feFlood・feComposite の色、feFuncA の濃さ) とぼかしだけのものは近似して図形にする (影は、0・0.5σ・σ・1.5σ・2σ 太らせた半透明の写しの重ね。
ぼかしだけのものは元の図形のまま)。ほかの SVG は仮の枠で描き、警告する。

## 区切り領域・斜体・上付き

- `xsl-footnote-separator` に文字や背景色つきのブロックがあれば、線ではなくその内容を、脚注領域の幅いっぱいに組んで区切りにする。
- `xsl-before-float-separator` は、`float="before"` のある段・ページだけ、前方 float と本文の間に置く (`LPageSequence.beforeFloatSeparator`)。
- 脚注本体のブロックの `space-after` は、次の脚注との間隔になる。脚注本体は、参照元のブロックの書体・揃え・色を引き継ぐ。
- `font-style="italic|oblique"` は疑似斜体 (12° の傾斜。Canvas・PDF とも同じ式)。`fo:inline` の `baseline-shift` (super / sub / 長さ) はグリフの持ち上げで表す。ずらした字のある行は、その字の行の高さの領域 (半行間を含む) をずらした分だけ広がる (`line-height-shift-adjustment="disregard-shifts"` なら広げない)。
- 画像などの箱のある行 (字の無い行を含む) の、ブロックの字の矩形 (nominal-requested-line-rectangle。XSL §4.5) は、ブロックの nominal-font (§5.5.7: font-family などで選ぶ書体) の上下で決める。総称の書体名 (serif など) は和文と欧文の書体の組に当てているので、日本語・中国語・韓国語の文書 (言語の指定が無いときも) は組の和文の書体、それ以外の言語の文書は欧文の書体を nominal-font とする。
- `line-height.conditionality="discard"` は、参照領域 (ページ・段・ブロックコンテナ・インラインコンテナ・表のセル。XSL §6.5.3・§6.6.8・§6.7.10) の最初の行の上の半行間と、最後の行の下の半行間を捨てる (XSL §7.16.4・§4.3.1)。行と参照領域の端の間に、罫線・余白 (padding) のあるブロックの端があれば捨てない (§4.3.1)。`line-stacking-strategy="line-height"` では、半行間は行の矩形に含まれるので捨てない (§4.5 の Note)。line-height を数・長さで指定すると retain に戻り、conditionality だけの指定は受け継いだ値を変える。`line-height.precedence` (§4.3.1): force (既定。line-height を一つの値で指定したときも force) は続く行の上下の半行間を足し、数なら同じ段落の続く行の半行間は大きい方だけを残す (`line-stacking-strategy="line-height"` では重ね合わせない)。`line-height.minimum`・`.maximum` は、行送り (optimum、無ければ normal) を下限・上限の間に収める (余白の伸び縮みで行を調整することはしないので、行送りは常にその値)。
- `axf:ligature-mode="latin"` (欧文の合字) は、書体が合字の字 (U+FB00〜U+FB04) を持てばその字に置き換え、Unicode に合字の字の無い並び (fft・ffk など) も、書体の合字の表 (OpenType の liga) で 1 つの字形になるなら合字にする (横書きで、letter-spacing の無いとき)。書体が合字を持たなければ (Tinos の ff など) 合字にならない。
- 回転した (reference-orientation="90"・"270") ブロックコンテナを中身の大きさでページごとに置くときも、中の先頭の余白 (space-before) は捨てる (参照領域の先頭)。

段組での脚注・前方 float・区切り: 既定では、前方 float とその区切りは本文領域の上端、脚注とその区切りは下端に、
全段を貫く幅で置き、段はその間に組む。領域の高さは組んでみないと分からないので、ページごとの予約を増やしながら安定するまで (最大 6 回) 組み直す。
`axf:footnote-position="column"` を `fo:region-body` に指定したときだけ、脚注を段ごとに置く (`PageMaster.columns.footnotePosition`)。
`axf:footnote-position="outside"` (横書きのページ・段組でない本文) は傍注にする (`PageMaster.sideNotes`)。奇数ページは region-end、偶数ページは region-start の領域の幅で脚注の本体を組み、参照する行の上端の高さから置く。前の傍注に重なるときは、その下へ送る。そのページに領域が無ければ、ふだんの脚注にする。
`space-before.conditionality="retain"` は、段・ページの先頭でも余白を残す (`BoxStyle.retainSpaceBefore`)。段組の先頭のブロックにあるときは、続く段の頭も同じ量だけ下げる。

## 書体の読み込み (MS 明朝・MS ゴシックなど)

画面の「書体を読み込む」で、お使いの PC にある TTF / OTF / TTC を選ぶ (Windows なら `C:\Windows\Fonts` の `msmincho.ttc`、`msgothic.ttc`)。
TTC は書体ごとに単独のフォントに分け (`src/fontLoader.ts`)、英語のファミリ名と別名 (和名) を読む。読み込んだ書体は IndexedDB に保存し、次回も使える。外部へは送らない。

FO の `font-family` は、並び全体で解釈する (和名・全角・空白の違いは吸収: `ＭＳ 明朝` = `MS Mincho`)。
- 先頭が読み込んだ書体: 欧文も含めてその書体で組む。
- `Times New Roman, ＭＳ 明朝` のように欧文用の書体が先にある: 欧文は Tinos (ゴシック系なら Arimo)、和文は読み込んだ書体で組む。
- 一致する書体が無い: 従来どおり (ゴシック系・太字は Noto Sans JP、それ以外は Noto Serif JP)。

PDF には、使った書体だけをサブセットで埋め込む。書体のライセンスは、読み込む方の責任で確認すること。

## keep-with-next・text-align-last・罫線の線種

- `keep-with-next` / `keep-with-previous` (`always` または 1 以上の整数) は、`LBlock.keepWithNext` / `keepWithPrevious` へ。つなげた並びと、その次のブロックの先頭が同じページに載るかを試し組みで調べ、載らず、改ページすれば載る場合に限り、並びの前で改ページする。
- `text-align-last` は `textAlignLast` へ (継承される)。`relative` は未指定と同じ (両端揃えの最終行は先頭詰め)。
- `border-style` は dotted / dashed / double / groove / ridge / inset / outset を `BorderSide.style` に保持し、Canvas・PDF とも矩形の組み合わせで描く。
  模様と角は次のとおり:
  - 辺を時計回り (上は左から右、右は上から下、下は右から左、左は下から上) に描く。破線は、太さ w に対して [線 4w・空き 2w] を、半分の長さ (2w) の線から始める。点線は、線の中心を通る道 (両端から w/2 内側) に、2.5w ごとの丸い点を置く。どちらも端で模様を均さず、反対の端は余りのまま終わる。時計回りで前の辺が同じ種類・太さ・色なら、模様は角をまたいで続く。
  - groove / ridge / inset / outset の明るい側は白と半々に混ぜた色、暗い側は元の色の 2/3。角は、外の角と内の角を結ぶ線で斜めに突き合わせる (実線は、隣の辺と色か種類が違うときだけ)。表のセルは表の外の角だけを突き合わせ、中の罫線との交わりでは、横の線を切らずに通す。帯が 0.5pt より細いときは、線 (stroke) で描く (表示で 1 画素以上の太さになる)。
- 段組のブロックコンテナ (`column-count`) の中の要素の幅と百分率の基準は、1 段の幅 (例: `width="80%"` の画像は 1 段の幅の 80%)。
- 段組で、段をまたぐ (`span="all"`) ブロックの後の強制の段区切り (`break-before="column"`) では、次の段の頭の retain の余白を、見出しの space-after と二重に空けない (1 段目の頭とそろう)。
- 回り込み (float) の横に並ぶ行がページをまたぐときも、`widows` / `orphans` を守る (次のページへ行く行が widows に満たなければ、このページの行を送る)。
- 段組のページ (region-body の `column-count`) でも、flow の中の要素の幅と百分率の基準は 1 段の幅 (例: 段組のページの `inline-progression-dimension="50%"`)。段をまたぐ (`span="all"`) ブロックは本文の幅。
- `inline-progression-dimension.minimum` だけの指定: 領域の幅が下限より狭ければ下限の幅にする。`block-progression-dimension.minimum` だけの指定: 中身が少なくても、その高さを取る (`BoxStyle.minBlockSize`)。
- 互換モードの絶対配置のブロックコンテナで、`left`・`right` のどちらも無いときは、内容の端を基準の領域の左端に置き (枠はその外)、幅の指定が無ければ基準の領域の右端までにする。`top` だけのときに下端まで伸ばすのは、`block-progression-dimension.minimum` の無いときだけ。

## text-align の inside / outside

綴じ側を基準にした揃え。奇数ページでは inside = start (左)・outside = end (右)、偶数ページでは逆。組むページの偶奇は行を置く時点で決まるので、
ページをまたぐ段落でも、ページごとに寄せ方が変わる。ブロックコンテナ・表のセルの中では、そのコンテナが置かれるページで決まる (`FlowHost.pageNumber`)。

## start-indent / end-indent と border・padding

`start-indent` / `end-indent` は、border・padding の**内側** (内容領域) の端が、親の内容端から何 mm かを表す。border・padding はその外側に付くので、
`margin = indent の差分 − border − padding` (負になることもあり、親の枠からはみ出す)。`margin-left` などを指定した場合も、子が継承する indent は
親の内容端 + margin + border + padding として数える。

罫線の描画順: ブロックの罫線は、子の描画のあとに (最前面に) 描く。`start-indent` などで子が親の枠の外へはみ出したとき、親の罫線が子の背景・罫線に隠れない。

letter-spacing: 値 (長さ) で指定した行は字間が固定なので、`text-align="justify"` でも字間を伸縮せず、行を左 (start) に詰める (`fixedLetterSpacing`)。`letter-spacing="normal"` で解除する。

根拠 (XSL-FO 1.1 §7.17.2): `letter-spacing` が `normal` のときだけ、処理系は両端揃えのために字間を調整してよい。`<length>` では「User agents may not further increase or decrease the inter-character space in order to justify text」で、`.minimum` = `.optimum` = `.maximum` となる。
`<space>` 形式 (`letter-spacing.minimum` / `.maximum`) は、その範囲内で調整できる。ここでは `.maximum − .optimum` を、1 字間あたりの広げる上限 (`letterSpacingStretch`) として扱う (縮める側 `.minimum` は未対応)。
単語間の空白との調整順序は処理系依存 (仕様)。Kumiori は、字間を長さで指定した行では空白も伸ばさない。

`fo:inline` の `inline-progression-dimension` (固定の長さ) は `LInline.width` になる。内容が短いときは、余りを空白で埋め、inline の背景色をその空白にも付ける
(例: `<fo:inline inline-progression-dimension="2em" background-color="yellow"/>` は 2em 幅の黄色い箱)。

keep-with-next が連なる並び: 並びの先頭ブロックと、並びの次のブロックの先頭が、同じページ (段組では同じ段) に載ることを試し組みで確かめる。載らず、新しいページ (段) なら載るときだけ、並びの前で改ページ (改段) する。

`fo:external-graphic` の `content-width` / `content-height` の百分率 (`60%` など) は、画像本来の大きさ (px × 0.75 = pt) に対する倍率として扱う (`LImage.widthScale` / `heightScale`)。
周りの幅に対する割合ではない。`width` / `height` の百分率は、これまでどおり周りの幅に対する割合。

長さの式: `space-before="20mm+18pt+30pt"` のような、長さの足し算・引き算 (`+` / `-` でつないだ項。単位は pt・mm・cm・in・px・pc・em・%) を解釈する。掛け算・割り算・括弧・数の関数 (`floor()`・`round()`・`min()` など) も解釈する (後述の §5.9)。性質の値を参照する関数 (`from-parent()`・`inherited-property-value()` など) は未対応で、警告で知らせる。

## XSL 1.1 仕様に合わせた変更 (仕様レビュー)

- 表の `border-collapse` は初期値 `collapse` (§7.28.3)。隣り合うセルの罫線は、太い方 (同じなら線種 double > solid > dashed > dotted …) を 1 本だけ描く。
  collapse の表の幅の指定は、外枠の罫線の中心から中心までの幅で、外枠の罫線の外の半分は表の外 (余白の側) へ出る (CSS 2.1 §17.6.2)。
  互換モードでは、行の高さの指定も罫線の中心から中心までとして測る (表が持つ外枠の罫線に接する行は、その罫線の半分だけ低く、行の間の罫線は、その半分ずつを上下の行が持つ)。
- `table-cell` の `display-align` (継承される) に対応。
- `line-height` を長さ・百分率で指定したときは、計算済みの長さのまま継承する (§7.16.4)。数値は比のまま。
- margin-top などの block 方向の前側の margin から決まる space は、ページ・段の先頭でも残す (§5.3.2 の conditionality=retain)。
- 空白・改行: `linefeed-treatment` / `white-space-treatment` / `white-space-collapse` / `wrap-option` と略記 `white-space` を、それぞれの初期値どおりに扱う。タブは空白 1 つ。
- `font-size` のキーワードは medium (仕様モード 12pt・互換モード 10pt) から 1 段ごとに 1.2 倍。線種だけ指定した罫線の太さは medium。罫線の `thin` / `medium` / `thick` は、仕様モードでは CSS の値 (0.75pt / 2.25pt / 3.75pt)、互換モードでは 1pt / 3pt / 5pt。
- 改ページ: `break-before` / `break-after` の `column` (段組なら次の段)・`odd-page`・`even-page` (偶奇が合わなければ白ページを挟む) に対応 (§7.20.2)。段組で `page` は、残りの段を空けて次のページへ。表の `break-before/after` も効く。
- `initial-page-number` の `auto-odd` / `auto-even`、`force-page-count` (既定 auto: 次の page-sequence の initial-page-number が数値なら、それに続くよう最後のページの偶奇を合わせる) に対応 (§7.27.6-7)。
- `id` を inline・wrapper・表の行・セル・リスト項目・ブロックコンテナ・画像・inline-container からも取り込み、page-number-citation の参照先にする。
- writing-mode: `tb-lr` は行を左から右へ積む縦書き (`vertical-lr`)。`lr` / `tb` は `lr-tb` / `tb-rl` の略。`rl-tb` (`rl`) と `direction="rtl"` は右から左の横組み (`direction: 'rtl'`): 行は右から並べ、start / end は右 / 左、`text-align` の left / right は end / start、表 (リスト) の列も右から。字の並べ方は UAX #9 (Unicode Bidirectional Algorithm、Unicode 18.0.0) で決める (下の「双方向のテキスト」)。アラビア文字などのつながる字 (Joining_Type が D・R・L・C の字と、その後ろの結合記号) は、並びを 1 単位にまとめて書体の字形の置き換えで測り、描く (語頭・語中・語尾・独立形と、ラーム・アリフなどの必須の合字。横書き)。単位の中の記号の位置などの GPOS の調整も、測る幅と PDF の字の位置に入れる。ルビのはみ出しは扱わない。下から上へ・行ごとに向きの変わる値 (§7.29.7) は、横・縦で組んだ後に軸を裏返して表す: `bt-lr`・`bt-rl` は縦書きの行の中を下から上へ (横向きに組む欧文の字の向きは上から下のまま)、`lr-bt`・`rl-bt` は行とブロックを下から上へ積む、`lr-alternating-*` は偶数行を逆の向きに並べ、`lr-inverting-*` は偶数行を 180 度回す (逆さの字で右から左)、`tb-lr-in-lr-pairs` は 2 字ずつの縦中横を縦に積む (1em に収める)。block-container と、page-sequence・region-body の writing-mode に効く。裏返すコンテナは、高さの指定が無くてもページをまたがずに 1 つの箱にする。
- リージョンの枠線 (互換モードだけ描く) は、リージョンの内側に描き、中身 (static-content・本文) はその内側に置く (中身は枠の太さの分だけ内側に入る。thin の枠なら 1pt、medium の枠なら 3pt)。
- リージョンの配置は、`simple-page-master` の書字方向で決まる辺に置く (§6.4.15-18)。tb-rl のページなら region-before は右端、region-start は上端。リージョンと本文の書字方向の既定は、ページの書字方向。
- keep: 表の行・リスト項目の `keep-with-next` / `keep-with-previous` (つながった行はまとめて次ページへ。1 ページに入らない長さなら分ける)、表の `keep-together` と `keep-with-next`、inline の `keep-together` (within-line: 行の途中で分割しない)。強さの整数は区別しない。

## 既定値の流儀 (互換モード / 仕様どおり)

`ImportOptions.compat` (画面では「仕様どおりの既定値で組む」) で切り替える。
- `spec` (既定): XSL-FO 1.1 の初期値どおり。font-size medium = 12pt (CSS2 の推奨)、line-height normal = 1.2 (推奨範囲 1.0〜1.2 の上限)、text-align start、ぶら下げ無し
- `antenna`: 10pt・行送り 1.2・行末の句読点を詰めて収める (AH Formatter 向けに書かれた文書を組むための値)

### 仕様どおりに組み、互換モードでだけ変えるもの

仕様 (XSL 1.1) どおりに作り、公開されている見本の PDF と見比べて組み方を変える必要が分かったものだけを、互換モード (`antenna`) で変えている。

| 項目 | 仕様モード (`spec`) | 互換モード (`antenna`) | 根拠 |
|---|---|---|---|
| 表の罫線を重ねるとき (collapse) の内側の線 | 隣り合うセルが半分ずつ持つ (§6.7.10) | 後ろ (右・下) のセルが全体の太さで持つ | 見本の PDF との比較 (文字の位置) |
| letter-spacing | Alphabetic の字の前後に半分ずつ。行頭・行末の分は捨てる (§7.17.2) | 句読点を含むすべての字の後ろ | 見本の PDF との比較 (行の分かれ方) |
| 行の高さ (max-height・line-height) | §4.5 の規則。字の上下は書体の ascent・descent | 従来の決め方 (書体の上下の高さと em の箱を使い分ける) | 見本の PDF との比較 (§4.5 の規則に書体の ascent・descent を使うと差が増えた) |
| 表の行の height | minimum = optimum = maximum (§7.15.3) | 最小の高さ (中身が多ければ広がる) | 従来の比較 |
| capitalize | 語の残りの字を変えない (§7.17.6) | 語の残りの字を小文字にする | 見本の PDF との比較 |
| ブロックの字より大きい字のある行 (max-height) | §4.5 の規則 | 字の大きさの箱を囲み、ブロックの半行間を上下に足す (§4.5 と同じ考え方) | 見本の PDF との比較 |
| top だけを指定した絶対配置のコンテナ | 中身の高さ (CSS2 の絶対配置) | bottom を 0 として基準の領域の下端まで伸ばす | 見本の PDF との比較 |
| 横書きの行の中の、縦書きを回した inline-container | 基線にそろえる | 箱の中央を字の中央の線にそろえる | 見本の PDF との比較 |
| 回転した block-container (90°・270°) がページをまたぐとき | 横幅は中身の大きさ | 本文の幅いっぱい (270° は右に寄る) | 見本の PDF との比較 |

### 仕様どおりにしたもの (両方のモード)

- 長さの式 (§5.9): 掛け算・割り算は足し算・引き算より強く結びつく。括弧・`mod`・`floor()`・`ceiling()`・`round()`・`min()`・`max()`・`abs()`。`proportional-column-width(N)+長さ` の列幅 (§5.10.4)。`lh` 単位 (行の高さ) は罫線の太さで読む
- 表の罫線の重ね合わせ (§6.7.10): セル・行・行グループ・列・表の罫線から線分ごとに 1 本を選ぶ (table-footer も含む)。`hidden` はすべてに勝って線を消す。太さ・線種が同じで色だけ違えば、セル > 行 > 行グループ > 列 > 表。`transparent` の罫線は場所だけ取って描かない
- `border-separation` / `border-spacing` (§7.28.5・§7.31.9)、`empty-cells="hide"` (§7.28.10)、table-row の無い表の `starts-row` / `ends-row`、セルの `column-number`
- 幅の指定がある `table-layout="auto"` の表も自動レイアウト (§6.7.3)。足りない幅は伸びる leader の列に配る
- リスト: ラベル・本体の start-indent は参照領域からの位置 (list-block 自身の字下げを二重に足さない)。`label-end()` のラベルの終端は provisional-distance-between-starts − provisional-label-separation (§7.30.11)。list-item の space-before / space-after は行の前後の余白にして、隣の項目と重ね合わせる
- 余白 (§4.3.1): 同じ優先度の余白は、符号も含めて最も大きい値。強制改ページの後のページ先頭の conditional な余白は捨てる。retain の余白より後ろの conditional な余白は残す。ブロックコンテナは参照領域なので、中の先頭・末尾の余白を外の余白と重ねない (§4.2.5)
- 百分率の基準: margin・padding・text-indent は包含ブロック (親の内容) の幅 (§7.11.1)、height・block-progression-dimension は高さの決まった包含ブロックの高さ (§7.15.6)、ページ・region-body の margin はページ (page-reference-area) の幅、region の extent はページの寸法 (§7.27.4。負の値は 0)、baseline-shift は親の line-height (em はその inline の font-size。§7.14.3)、leader-length は置く領域の寸法 (§7.22.4)
- 罫線・余白の `.conditionality="retain"`: ページ・段で分かれた断片の切れ目でも残す
- 絶対配置 (§7.6.1): `right`・`bottom` は基準の領域 (本文領域・リージョン) の端から測る。`absolute-position="fixed"` はページが基準。一括指定 `position` も読む (§7.31.20)
- 一括指定 (§5.2・§7.31): `font`・`background`・`page-break-before`・`page-break-after`・`page-break-inside`・`size` を個別の性質に分けて読む (個別に書いた性質が勝つ)。`page-break-*` は §7.31.16〜§7.31.18 の表のとおり (`always` → `break-*="page"`、`left` → `even-page`、`right` → `odd-page`、`avoid` → `keep-with-previous`・`keep-with-next`・`keep-together` の `always`)。`font` のシステムの書体の語 (`caption` など) は読まずに報告する。`size` の `landscape`・`portrait` は、用紙 (A4) の向き
- 寸法の上限・下限 (§7.15.8〜§7.15.11・§5.3.3): `min-height`・`max-height`・`min-width`・`max-width` は、書字方向で block / inline の `.minimum`・`.maximum` に当てる。横書きの箱の `min-height` (高さの下限)・`max-width`・`min-width` (幅の上限・下限) と、表の行の block 方向の下限・上限を読む。横書きの箱の `max-height` と、縦書きの箱の上限・下限は、組版に受け皿が無いので読まずに報告する
- `clear` (§7.19.1): `fo:block` の `start`・`end`・`both` (`left` は `start`、`right` は `end`) は、その側の先の float の下から始める (`LBlock.clear`)。`inside`・`outside` と、`fo:block` 以外の要素の `clear` は読まずに報告する
- `fo:folio-prefix`・`fo:folio-suffix` (§6.6.13・§6.6.14): 中身 (字と行内の要素) を、ページ番号の前後に付ける。`fo:page-number` はそれを含む `fo:page-sequence` のもの (§6.6.10)、`fo:page-number-citation`・`-last` は `ref-id` の要素を含む `fo:page-sequence` (引いたページを作ったもの) のもの (§6.6.11・§6.6.12)。`axf:physical-page-number="true"` の参照には付けない。中の `fo:page-number`・ブロックの要素は読まずに報告する
- 索引 (§6.10・§7.24): `index-key` (と `index-class`) の付いた要素と、`fo:index-range-begin`〜`fo:index-range-end` の範囲を、鍵の付いた所 (`LDocument.indexEntries`) として控え、`fo:index-page-citation-list` を、引く鍵 (`fo:index-key-reference` の `ref-index-key`)・番号の字の書式・前後の字 (`fo:index-page-number-prefix`・`-suffix`)・区切り (`fo:index-page-citation-list-separator`・`-range-separator`) を持つ行内の節 (`LIndexPageCitationList`) にする。ページ番号の並びは、組版が、id のページの記録 (リンク先・しおり・`page-number-citation` と同じ仕組み) から、§6.10.6・§6.10.7 の手順 (`src/indexCitation.ts`) で作る
  - 鍵の付いた所: id を組版へ渡す要素 (block・inline・wrapper・basic-link・bidi-override・character・表・行・セル・リストの項目・block-container・inline-container・画像・page-sequence・flow)。id が無ければ `kumiori-index-N` を付ける。その要素の領域のあるページすべて (最初のページ〜最後のページ) を引く (§6.10.6)。行内の要素は、中身の終わりに幅の無い目印を置いて最後のページを引く。中身の無い `fo:wrapper` と `fo:index-range-begin` は領域を作らない目印で、ブロックの間 (行を作らない所) にあるときは、次に置かれる中身のページを引く (後ろに中身が無ければ前の中身のページ)。それ以外の要素 (leader・page-number-citation・footnote など) の `index-key` は、読まずに報告する (`index-key (fo:名前)`)
  - 並びの作り方: 1 つの `fo:index-key-reference` の中で同じページの項目を 1 つにし (範囲の項目を先に残す)、すべての項目をページの順に並べ、`merge-pages-across-index-key-references` が `merge` (初期値) なら同じページは文書の中で先の `fo:index-key-reference` のものだけを残す。`merge-sequential-page-numbers` が `merge` (初期値) なら、続いた 3 つ以上のページを範囲にする (`index-class` の違うページと、`merge-ranges-across-index-key-references="leave-separate"` のときの別の `fo:index-key-reference` のページは、同じ範囲にしない)。3 つの性質と `page-number-treatment` は継承される (祖先に書いた値も読む)
  - 字にするとき: ページ番号は、引いたページを作った `fo:page-sequence` の `format` と `fo:folio-prefix`・`fo:folio-suffix` (§6.6.10)。書式は引いた `fo:index-key-reference` のもの。前後の字は番号と同じ行に置く。範囲の区切りの既定は U+2013、並びの区切りの既定は「, 」(カンマは前の番号と同じ行に置く)。`page-number-treatment="link"` は、引いた所の id (その所がそのページに無いとき = 範囲の途中のページ・ページをまたぐ所の続きのページは、ページそのものを指す飛び先 `kumiori-index-page-N`。N は文書の先頭からの通し番号) への文書内リンク
  - 収束: ページ番号の参照と同じ組み直しに乗せる (最初の 1 回と、組み直し 4 回まで)。1 回目は、組んでいる途中のページから並びを作る (索引が本文の後ろにあれば 1 回で決まる)。組み終えたページで作り直した並びが、組んだときの並びと同じなら終わり。索引の無い page-sequence は組み直さない。決まらなければ、上限で止めて「索引のページ番号の並びが収束しませんでした」と警告する
  - 誤りの回復: 存在しない鍵の `fo:index-key-reference` は無視して警告 (§6.10.6)。組になる `fo:index-range-end` の無い範囲は文書の終わりまで (§6.10.4)、組になる `fo:index-range-begin` の無い `fo:index-range-end` は無視 (§6.10.5。どちらも読み込みの注意に出す)。`id` か `index-key` の無い `fo:index-range-begin`、`ref-index-key` の無い `fo:index-key-reference` は、読まずに報告する
  - アンテナハウスの索引の拡張 (`axf:suppress-duplicate-page-number`・`axf:index-page-citation-range-f-suffix`・`axf:index-page-citation-range-ff-suffix`) は読まない
- `font-variant="small-caps"` (§7.9.8): 字の並びを small caps の印の付いた行内の箱にする (`LInline.smallCaps`。書体に smcp があればその字形、無ければ 0.7 倍の大文字)。`word-spacing` (§7.17.8): 長さ (`<space>` は `.optimum`) を `wordSpacing` にして、語の間の空白に足す
- `glyph-orientation-vertical` (§7.29.3): `auto` は `textOrientation` の `mixed`、`0deg` は `upright`、`90deg` は `sideways` (角度は 90 度の倍数の近い方に丸める。単位は `deg`・`grad`・`rad`)。180・270 度と、`glyph-orientation-horizontal` (§7.29.2) の 0 度以外は、組版に受け皿が無いので読まずに報告する
- `relative-position="relative"` (§7.13.5・§5.5.5。一括指定 `position="relative"` も): 横書きの `fo:block` を、`left`・`top` (無ければ `right`・`bottom` の逆) だけずらす (`LBlock.relativeOffset`)。ほかの要素・縦書きでは読まずに報告する
- `visibility` (§7.30.17): `hidden`・`collapse` は、字の色を `transparent` にして運び、背景・影を外し、罫線を `transparent` にする (場所は残す。継承され、`visible` で戻る)。表の行・列の `collapse` は `hidden` として扱い、報告する
- `z-index` (§7.30.18・§5.4.5): 絶対配置の `fo:block-container` で、親の値に足した値が負なら本文の背面 (`layer: 'behind'`)。コンテナの中の絶対配置の箱と、relative の `fo:block` の負の値は報告する。0 以上の値の重なりの順は文書の順のまま
- ページマスターの em は fo:root から受け継いだ font-size が基準。ページ番号の書式は XSLT 1.0 §7.7.1 どおり (最初のトークンだけを使い、知らないトークンは 1)
- `line-stacking-strategy="font-height"` (行送りはいつも line-height。§4.5)
- leader の初期値: `rule-thickness` 1pt、`leader-length` 0pt / 12pt / 100%。`leader-pattern-width` は字の幅より狭くしない (§7.22)。rule の線は中心を基線に置き、太さを上下に等しく付ける (§7.22.6)
- `white-space-treatment="preserve"`・`ignore-if-after-linefeed` の行末の空白は消さない (§7.16.8)
- ページ番号の桁区切り (§7.26.2 `grouping-separator`・§7.26.3 `grouping-size`。XSLT 1.0 §7.7.1): `fo:page-sequence` に両方を書くと、10 進の書式の番号 (`fo:page-number`・ページ番号の参照・索引のページ番号) を、後ろから `grouping-size` 桁ごとに `grouping-separator` (1 字) で区切る。片方だけなら無視。1 字でない区切り・正の整数でない桁数は報告する。`letter-value` (§7.26.4) は値だけを確かめる (対応している書式トークンに、2 通りに読めるものが無い)
- `last-line-end-indent` (§7.16.3。継承される): 行内の並びの最後の行 (ブロックの最後の行と、子のブロックの前で終わる行) の終わりの端をずらす (`lastLineEndIndent`)。残りの中身が、ずらした幅の 1 行に入ればその行が最後の行。ふだんの幅には入るが、ずらした幅 (狭い) に入らないときは、ずらした幅で折り返して残りを最後の行に送る。`text-align-last` の揃え・リーダーの伸びは、ずらした端まで。強制改行で終わる行には当てない。目次の行 (`text-align-last="justify"` + `end-indent` + 負の `last-line-end-indent`) で、ページ番号だけを端に出せる
- `leader-alignment` (§7.22.1。継承される): `reference-area`・`page` のとき、点・中身の繰り返しの周期の始まりを、参照領域 (本文の領域・段・表のセル) の内容の始めの端・ページの始めの端からの `leader-pattern-width` ごとの格子に合わせる (`LLeader.alignment`。ページに置いた後で並べ直す)。`none` (初期値) は、いままでどおり行の始めからの格子。右から左の行は読まずに報告する。回した `fo:block-container` の中・`fo:static-content` の中では `none` と同じ。`fo:block-container` は参照領域に数えない (外の参照領域が基準)
- `fo:initial-property-set` (§6.6.4): `fo:block` の最初の行内の並び (最初の `fo:marker` の後ろから、最初のブロックの子の前まで) を、最初の行にだけ書式を当てる inline (`LInline.firstLine`。CSS の `::first-line` と同じ受け皿) で包む。当てるのは、フォントの性質・`color`・`letter-spacing`・`word-spacing`・`text-decoration`・`background-color`。em の長さの基準はブロックの字の大きさ。`text-transform`・`font-variant` (読み込みのときに字を置き換えるので、行ごとには当てられない)、`line-height` (行内の要素の line-height を行の高さに数える受け皿が無い)、罫線・`padding`・`relative-position`・`text-shadow`・`score-spaces` は読まずに報告する。並びの途中に `fo:float`・絶対配置の箱があるとき、`fo:block` の子でないときも、読まずに報告する
- 変更バー (`fo:change-bar-begin`・`fo:change-bar-end`。§6.13.2・§6.13.3・§6.4.5): 読み込みの最初に文書の順にたどって範囲を決め (同じ `change-bar-class` の、入れ子の深さの合うものが組。終わりの無い始まりは文書の終わりまで、始まりの無い終わりは無視して報告)、範囲の中の要素と文字に、効いている線の並びを付ける (`changeBars`。組版は、その字を含む行の横に引く。axf の改訂バーと同じ受け皿 `RevisionBar` に `changeBar: true`)。線の値は始まりの要素でのもの (`change-bar-color`・`-offset`・`-placement`・`-style`・`-width`。§7.30.2〜§7.30.6。どれも継承される)。`change-bar-offset` は段の端からバーの中心まで。`change-bar-placement` の `inside`・`outside` は、奇数ページの綴じる側を始めの端、偶数ページを終わりの端とする (§6.4.5 の注)。`alternate` は 2 段のとき 1 段めの始めと 2 段めの終わり、ほかは `outside`。縦書きの `left`・`right` は `start`・`end` として扱い報告する。`fo:static-content`・脚注の本体・前方の float・`fo:marker` の中には付けない。行を持たない領域には引かない。`z-index` は読まない (報告)
- `fo:retrieve-table-marker` (§6.13.7): 表の header・footer のセルの中のものを、その表の断片 (ページ・段ごとの表の箱) の中のマーカーの中身に置き換える。マーカーは、本体のセルの子・セルの中のブロックの子・`fo:table-body` の子 (本体の領域に付く)。`retrieve-position-within-table` (§7.25.6) の 4 つの値と `retrieve-boundary-within-table` (§7.25.2) の `table`・`table-fragment`・`page` (同じページの前の段の断片まで)。is-first・is-last は、ページをまたいで分かれた行・本体の、最初・最後の断片で付く。header・footer は断片ごとに組む: 行の塊を 1 つ置くたびに、その塊までを入れたときの header と footer の高さで入るかを確かめ、入れば header をその中身に差し替える (高さが変われば、置いた行をずらす)。断片に入る行は前から順に決まるので、組み直しはしない。`fo:table` の子として書く形 (中身が `fo:table-header`・`fo:table-footer` になる書き方)、header・footer の外に置いたものは、読まずに報告する。入れ子の表の header の中のものは、入れ子の表のマーカーを取り出す。ページの `fo:retrieve-marker` は、`fo:table-body` の子のマーカーを取り出さない

### まだ仕様どおりでないもの

- `font-size-adjust` は読まない。`word-spacing` の `<space>` は `.optimum` だけを使う (伸び縮みの幅は使わない)
- `border-*-precedence` と `collapse-with-precedence` (collapse と同じに扱う)
- 回転・縦書きのブロックコンテナの中の絶対配置の基準 (コンテナに切り替えない)
- `simple-page-master` の `reference-orientation`

## その他の仕様対応 (S-12)

- ページ番号の書式 `format` (§7.26.1): `1` `01` `i` `I` `a` `A` `１` `一` と前後の文字 (XSLT 1.0 §7.7.1 どおり、最初のトークンだけを使う)。page-number・page-number-citation とも、参照先のページの書式で出す。
- `page-number-citation-last`: 参照先が置かれた最後のページ。
- `page-sequence-master` (§6.4.8-11): single・repeatable (maximum-repeats)・alternatives を順に使う。`blank-or-not-blank` は、偶奇合わせ・force-page-count で足した白ページを blank として扱う (段組のページでは未判定)。
- `overflow` (§7.21.2): `hidden`・`scroll`・`error-if-overflow` は切り抜き (block-container・リージョン)。`condense` などは未対応として報告。
- リスト: ラベルに `end-indent="label-end()"` があるときは、`provisional-label-separation` (既定 6pt) をラベルの後ろに空ける。
- 余白の優先度 (§4.3.1): `space-before/after.precedence` の force (合計) と整数 (高い方だけ残す)。
- 脚注の参照記号は、FO の参照側 inline の文字の大きさ・baseline-shift で組む。

## 文字の装飾・表のフッター・行の分割

- `text-decoration`: underline・overline・line-through と、打ち消しの `no-underline` など (`none` はすべて打ち消す)。子の inline に引き継がれ、inline の範囲いっぱいに線を引く。
- `font-stretch`: キーワード・百分率・wider / narrower (1 段ずつ)。字を横方向に伸縮する。キーワードの比率は、仕様モードでは CSS の値 (ultra-condensed 50% 〜 ultra-expanded 200%)、互換モードでは normal から 1 段ごとに 1.2 倍 (expanded が 1.44 倍、ultra-expanded が約 2.07 倍)。
- `text-transform`: uppercase・lowercase・capitalize (継承される。`none` で止める)。capitalize は語の最初の字を大文字にする (「Oliver's」のアポストロフィの後ろは語の続き)。互換モード (`--compat antenna`) では語の残りの字を小文字にし、仕様モードでは残りの字を変えない (XSL 1.1 §7.17.6)。オランダ語の「ij」を 1 文字として大文字にする処理は未対応
- `table-footer` は、改ページのたびに各ページの末尾で繰り返す (その高さを空けて本体の行を置く)。`table-omit-footer-at-break="true"` なら表の末尾だけ。`table-omit-header-at-break` も対応。
- ページに入らない表の行は、セルの中身を行単位で次のページへ分ける (keep-together の既定 auto)。`keep-together` を指定した行は分けずに次ページへ送る。rowSpan を含む行の塊は、1 ページに入れば分けずに送り、入らなければ、またぐセルを行ごとに分けて行の境目でページをまたぐ。
- inline の `border` / `padding` (文字を囲む枠)。行をまたぐときは、切れ目の側の罫線・余白を描かない。
- 和文の字間: 約物の連続 (」「 は間を二分、。」 はベタ、（「 は後ろの括弧の前を詰める) と、和文と欧文・数字の間の四分アキ (全角の空白 U+3000 も和字として扱う)。互換モードでオン、仕様モード (既定) ではオフ。`axf:punctuation-trim="none"` / `axf:text-autospace="none"` で止める。
  行頭の全角の始め括弧類 (（「『【 など) の前の二分アキも詰める (互換モードの既定。`axf:punctuation-trim` に start か start-except-first を含む指定で詰め、none と、end だけの指定では詰めない。値は空白で区切って組み合わせる (`start end` など。both という語は無い))。
  行末の全角の終わり括弧類・句読点 (」。、 など) の後ろの二分アキは捨てる (互換モードの既定。右寄せ・中央揃えの行では、行末の 。 の字面が行の端に来る。`axf:punctuation-trim` に end か end-except-fullstop を含む指定で捨て、none と、start だけの指定では捨てない。仕様モードでは捨てない)。
- 約物の詰めの間隔: `axf:punctuation-spacing` (初期値 0.5em)。終わり括弧類 (句読点を含む) の後ろ・始め括弧類の前のアキをこの値にする。終わり括弧類が続くとき (）、 など) は、そのアキからさらに二分詰める (0.5em ならベタ、0.25em なら 0.25em 重なる)。行に収めるときは、残っているアキを、字面の外のアキが無くなるまで (二分まで) 詰める。
- 双方向のテキスト: 横書きの段落の字の並べ方は、UAX #9 (Unicode Bidirectional Algorithm、Unicode 18.0.0) の規則 (P2〜P3・X1〜X10・W1〜W7・N0〜N2・I1〜I2・L1・L2・L4) で決める (`src/bidi.ts`。Unicode の適合試験 BidiTest.txt・BidiCharacterTest.txt のすべての件と一致)。段落の向きは `direction` (rtl・ltr)。
  左から右の段落の中のヘブライ語・アラビア語の語も右から左に並べ、右から左の深さの括弧などは鏡像の字にする (L4)。字の中の制御文字 (U+202A〜U+202E・U+2066〜U+2069) も効く。`fo:inline`・`fo:bidi-override` などの `unicode-bidi` (embed・bidi-override) と `direction` は、中身の前後に制御文字を入れたものとして並べる (§5.8)。HTML の `unicode-bidi` (embed・isolate・bidi-override・isolate-override・plaintext) も同じ (Writing Modes 3 §2.4.2。block の bidi-override は中身の全体を上書きし、plaintext は段落の向きを最初の強い字で決める)。縦書きの行でも、行の中の右から左の字の並びを並べ替える (段落の向きは上から下として扱い、`direction` の rtl の縦書きの配置は扱わない)。
- 字の単位は、UAX #29 (Unicode Text Segmentation、Unicode 18.0.0) の拡張書記素クラスタ (規則 GB1〜GB13) で決める (`src/grapheme.ts`。Unicode の適合試験 GraphemeBreakTest.txt と一致)。基底の字 + 結合文字 (e + U+0301、か + U+3099)・異体字セレクタ、絵文字の並び (肌の色・ZWJ・国旗・キーキャップ・タグ) は 1 つの字で、途中に改行 (`word-break: break-all`・`overflow-wrap: anywhere` を含む)・字間・両端揃えの空きは入らない (CSS Text 3 §1.3)。
  クラスタは 1 つの書体でまとめて組み (CSS Fonts 4 §5.3)、書体の字形の置き換え (GSUB) と位置合わせ (GPOS) で、結合文字を基底の字に載せる。禁則・約物の詰め・和欧間のアキ・縦書きの向きなど、字の種類で決まる処理は基底の字で決める。
  どの書体も並び全体を持たないときは、合成済みの 1 字 (é など) を持つ書体があればその字で、無ければ字ごとの書体で組む (その並びの途中でも、改行・字間・両端揃えの空きは入らない)。空白の後ろの結合文字は、空白にまとめない (UAX #14 LB10)。別の inline にまたがる並び (`e<span>&#x301;</span>`) は、まとめて組まない (UAX #14 LB9 により、その間に改行の機会は無い)。
- 改行の機会は、UAX #14 (Unicode Line Breaking Algorithm、Unicode 18.0.0) の規則 LB1〜LB31 で、段落の字の並び全体から決める (`src/lineBreak.ts`。文字のプロパティの表は `src/unicodeData.ts`。Unicode の適合試験 LineBreakTest.txt の 19,346 件と一致)。
  例: 斜線 (/) の後ろは欧文字の前なら改行してよい。コロン (:) の後ろは欧文字・斜線の前では改行しない (URL を「http:」と「//」の間で切らない)。数と後置記号 (14％) の間、結合文字の前では改行しない。
  向きの決まらない引用符 (ASCII の `"`) の前後は、和文の字との間でも改行しない (LB19)。
  CSS の `line-break` (strict・normal・loose・anywhere) は CSS Text 3 §5.2 のとおり調整する (normal・loose の、日本語・中国語だけの決まりは、言語が ja・zh のとき)。
  語の間に空白を書かない用字 (UAX #14 の SA。タイ語など) の字の並びは、UAX #14 の既定 (LB1) では AL として扱い、並びの中に改行の機会が無い。タイ・ラオ・クメール・ミャンマーの字の並びには、実行環境の `Intl.Segmenter` の辞書で求めた語の境目を、改行の機会として足す (UAX #14 §5.1 SA。`complexContextBreaks`)。語の境目は ICU の版で変わりうる。`Intl.Segmenter` の無い環境では足さない。確かめてあるのはタイ語だけ。
- 行頭禁則: `axf:line-break` の normal (互換モードの既定) では、小書き仮名・長音記号 (ー) を行頭に置いてよい (JLREQ §3.1.7 の注にある緩め方のうち、小書きの仮名・長音記号だけ。繰返し記号の「々」は緩めない)。繰返し記号 (ゝゞヽヾ々) は行頭禁則のまま (UAX #14 の NS の字)。strict (仕様モードの既定) では小書き仮名・長音記号も行頭禁則にする。数と全角の単位記号 (㎏ など) の間では改行しない (JLREQ §3.1.10)。閉じ括弧・句読点・中点などは、どちらでも行頭に置かない。
- 縦書きの字の向きは、UAX #50 の Vertical_Orientation で決める (U・Tu は正立、R は横倒し、Tr は縦書き用の字形があれば正立、無ければ横倒し)。CSS の `text-orientation` (upright・sideways) も使う。
  縦書き用の字形は、書体の OpenType の vert (縦書きで既定で使う機能) を先に使い、無ければ Unicode の縦書き用字形 (U+FE10〜FE48) か位置の補正で代える。
- ルビのはみ出し: 親文字より長いルビは、前後の仮名・約物にルビ文字 1 字分まで掛ける (漢字・欧文・行頭・行末には掛けない)。互換モードでオン、仕様モードではオフ。`axf:ruby-overhang="none"` で止める。
- ペアカーニング: `axf:kerning-mode` (または `font-kerning`) が none 以外なら、横書きの欧文にフォントのカーニングを掛ける。既定はオフ。
- 傍注 (marginal-notes の見本の書き方): float の中身が負の `start-indent` / `end-indent` で本文の外へはみ出すときは、本文の行幅を変えずに余白へ置く。`float="inside" / "outside"` は組むページの偶奇で start / end を決める。
- `simple-page-master` と `region-body` の `margin` の略記 (2〜4 値) を、上・右・下・左に展開する (これまでは 1 値しか読めなかった)。
- `axf:document-info` (title・author・subject・keywords) を PDF の文書情報に入れる。
- しおり: `fo:bookmark-tree` (`internal-destination`・`starting-state`) と、拡張 (`axf:*`) の `axf:outline-level` / `axf:outline-title` / `axf:outline-group` から、PDF のアウトラインを作る (飛び先は、その id が最初に置かれたページ)。
- 背景画像: `background-image`・`background-repeat`・`background-position(-horizontal/-vertical)`、大きさは `axf:background-content-width/height` (無ければ画像本来の大きさ)。ブロック・セル・ブロックコンテナ・リージョンに対応。PDF にも埋め込む (SVG はベクタのまま)。
- 段罫: `region-body` の `axf:column-rule-width/style/color`。
- リンク: `fo:basic-link` の `external-destination` (URI) と `internal-destination` (その id が置かれたページ) を、PDF のリンク注釈にする。行をまたぐリンクは行ごとの範囲。外への飛び先は、既定では、スキームが `http`・`https`・`mailto`・`tel` の URL と相対参照の PDF だけをリンクにする (`src/linkPolicy.ts`。ほかは字だけを組み、警告に知らせる。`links` の設定で選べる)。
- 注釈: `axf:annotation-type` (Text・FreeText・Stamp。FileAttachment は `axf:annotation-file-attachment` のファイルを添付する。ファイルが無ければテキスト注釈にする) と `axf:annotation-contents/title/color/text-color/font-size/icon-name/open/position-horizontal/position-vertical/width/height`。inline は最初の行、block は最初の断片の左上が基準。FreeText は埋め込み済みの書体で表示 (appearance) を作る。画面には注釈の目印を描く。
- 行番号: `axf:line-number` (show / hide / none) と `axf:line-number-format/initial/interval/start/reset/position/offset/font-family/font-size/font-weight/font-style/color`。page-sequence・flow・ブロックのどこに書いても子へ引き継ぐ。番号は段の端の外側に、行の基線をそろえて置く (縦書きは、本文の欧文と同じく時計回りに 90° 寝かせて、行の中央をそろえて段の上に)。段の端から番号までの間隔 (`offset`) の既定は 0。最初に出す番号 (`start`) の既定は数え始めの番号 (`initial`) で、`interval="2"` なら 1, 3, 5…と出す。番号の字の大きさの既定は、互換モードでは 10pt (本文の大きさによらない)。
- 角丸と影: `axf:border-radius` (水平半径・垂直半径。四隅共通) と角ごとの `axf:border-top-left-radius` など、`axf:box-shadow` (横・縦のずれ・ぼかし・広がり・色・inset。カンマで並べた複数の影)。角丸の罫線は、4 辺が同じ太さ・線種・色のときだけ丸めて描く。
- 斜めの罫線: `axf:diagonal-border-style/width/color` (対角罫。before-start の角から after-end の角へ) と `axf:reverse-diagonal-border-*` (逆対角罫。before-end の角から after-start の角へ)。一括指定 (`axf:diagonal-border="1pt solid black"`) も読む。表のセル・ブロック・ブロックコンテナに引く。
- 表の行の `height` / `block-progression-dimension`: 互換モードは行の高さの最小値 (中身が多ければ広がる)。仕様モードは minimum = optimum = maximum (§7.15.3)。
- フォーム: `axf:form` (`external-destination`・`axf:field-submit-method`) の中の `axf:form-field` を、PDF の AcroForm の欄にする。`axf:field-type` は text (password・multiline・maxlen・required)・checkbox・radio (同じ名前が 1 組)・listbox・combobox (`axf:form-field-option`)・button (`axf:action-type` の submit / reset、`axf:field-button-face`)。罫線・余白・大きさは FO の指定で Kumiori が描き、欄自身は透明。画面には欄の見本を描く。
- 改訂バー: `axf:revision-bar-style/color/width/offset/position` (start / end / both / alternate)。inline に付けたものはその文字を含む行、block に付けたものは中の行に、段の端の外側へ線を引く (続く行はつなげる)。段の端から線までの間隔 (`offset`) の既定は 0 (線が段の端に接する)。
- 自動脚注番号: 参照側の `axf:footnote-number` は脚注の自動連番、本体の `axf:footnote-number-citation` はその番号に置き換わる。page-sequence の `axf:footnote-number-format` (ページ番号と同じ書式。`Ⅰ`・`①`・`*1` なども)・`-initial`・`-reset="page"` (ページごとに振り直す)。
- 画像の枠: `external-graphic` / `instream-foreign-object` の `width` / `height` は画像を置く枠、`content-width` / `content-height` は画像の大きさ (既定 auto = 画像本来の大きさ。scale-to-fit などなら枠に合わせる)。枠の中は `text-align` / `display-align` で揃える (`text-align` は継承されるので、画像に無ければ親のブロックの値)。
- `fo:flow` に書いた継承されるプロパティ (font-size・font-family など) を取り込む。
- `fo:block-container` の中の indent (§5.3.2): 仕様モードでは、中の要素がコンテナの start-indent / end-indent の値を、コンテナの内容端から受け継ぐ (内側へ下がる)。互換モード (`--compat antenna`) は、見本の PDF との比較が済むまで従来どおり (外の indent を中へ持ち込まない。indent の付いたブロックの中のコンテナの組み方は、まだ確かめられていない)。
