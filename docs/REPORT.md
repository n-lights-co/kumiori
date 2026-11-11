> English: [en/REPORT.md](en/REPORT.md)

# Kumiori 組版アルゴリズム・レポート

「どう噛み合わせたか」を、座標計算の式まで落として記録する。単位はすべて pt（1/72 inch）。

## 0. 全体像：二相レイアウト

```
Logical Tree (JSON) ──▶ 論理座標でレイアウト (LNode: inline/block) ──▶ 物理化 toArea() ──▶ Area Tree ──▶ Canvas / PDF
```

縦書きでは「子の x = 親の幅 − block 位置 − 子の幅」となり、**親の幅が確定するまで子の x が決まらない**。
そこで レイアウト中は書字方向に依存しない論理座標 `(i, b)` だけを扱い、サイズ確定後に 1 回だけ物理座標へ変換する (`geometry.ts`)。

| | horizontal-tb | vertical-rl |
|---|---|---|
| inline 方向 | →（x+） | ↓（y+） |
| block 方向 | ↓（y+） | ←（x−） |
| 子の物理位置 | `x = i, y = b` | `x = PW − b − w, y = i`（PW = 親 content-box の物理幅） |
| 物理サイズ | `w = isize, h = bsize` | `w = bsize, h = isize` |
| block-start 辺 | top | **right** |

`margin/padding/border` は物理 4 辺で入力し、`toLogical()` で `bs/be/is/ie` へ写像して計算、出力は物理に戻す。

## 1. シート / ページ / 塗り足し / トンボ

```
extra   = bleed + (trimMarks ? trimMarkMargin : 0)          例: 3mm + 10mm
Sheet   = (W + 2·extra) × (H + 2·extra)                       ← MediaBox
PageArea.x,y = (extra, extra),  size = W × H                  ← TrimBox（コンテンツ原点）
bleedBox = (extra − bleed, extra − bleed, W + 2·bleed, H + 2·bleed)
RegionBody = PageArea 内 (margins.left, margins.top, W − l − r, H − t − b)
```

- 絶対配置は **PageArea 原点** 基準で `PageArea.absoluteAreas` に分離保持（通常フローの `cursor` を消費しない）。
  塗り足しまで届く背景は `top:-bleed; left:-bleed; width:W+2·bleed` のように負オフセットで指定する。
- 全ページ共通ヘッダー／フッターは `PageSequence.staticContent`。全ページ数が確定した後（二相目）にレイアウトし、`{pageNumber}` `{totalPages}` を置換。
- 描画順: ①塗り足し矩形に用紙背景 → ②**bleedBox でクリップ**して本文 → ③トンボ（クリップ外）。

**トンボ幾何 (`paint.ts: trimMarkLines`)**: 各コーナー `c = (cx,cy)`、外向き符号 `(sx,sy)`、`L = 0.85·trimMarkMargin`

```
水平: y = cy         と y = cy + sy·bleed の 2 本、x: cx+sx·bleed → cx+sx·(bleed+L)
垂直: x = cx         と x = cx + sx·bleed の 2 本、y: cy+sy·bleed → cy+sy·(bleed+L)
```
→ 仕上がり線と塗り足し線が作る二重 L（日本式トンボ）。センタートンボは各辺中央で、塗り足し端から外へ長さ L の中心線と、その中点を横切る長さ L の十字バー。
PDF では色材名 All の Separation（レジストレーション色。すべての版に出る。ISO 32000-2 §8.6.6.4。代わりの色は `cmyk(1,1,1,1)`）、線幅 0.3pt。

## 2. ブロックレイアウトとページネーション (`layoutEngine.ts: Flow`)

**Frame スタック**: 開いているブロックの「現ページ上の断片」を `Frame{node, startB, contentStartB, opened}` で保持。`cursor` は region body 先頭からの block 消費量。

- **マージン相殺**（CSS 2.1 準拠）: 保留値 `pending = maxPos + minNeg` を持ち、兄弟間・親子間（border/padding が無い辺）で畳む。
  最初の内容（行・表の行・葉ボックス）が置かれる瞬間に `flush()` が保留値を `cursor` に加算し、未オープン Frame を `startB = cursor` で確定する。
  検証: `A(mb=10) B(mt=20)` → 間隔 20、入れ子の先頭子 `mt=12` が親 `mt=5` と相殺 → 12。
- **改ページ `breakPage()`**: 内側→外側の順に全 Frame の断片を `bsize = cursor − startB` で閉じ、block-end 側の border/padding/margin を切り落とす（`box-decoration-break: slice`）。
  新ページで外側→内側に断片を再オープンし、block-start 側の border/padding を切り落とす。保留マージンは破棄。
  検証: 40 行の枠付きブロックは 4 断片（上罫は先頭のみ・下罫は末尾のみ）。
  **空の断片は残さない**: 罫線・余白つきの Frame は開いた時点で先頭側の罫線が出るため、最初の内容が次ページへ送られると罫線だけの断片が前ページに残る。`breakPage` は中身の無い断片を取り除いて未オープンに戻し、次ページで最初の内容と一緒に（先頭側の罫線・余白ごと）開き直す。
  **表だけは `clone` 相当**: 断片ごとに外枠（横書きは上下、縦書きは右端・左端の罫線）を閉じる。終端の罫線の分だけ断片を伸ばし、行の収まり判定にもその分を見込む（余白・padding は slice のまま切る）。
- **widows/orphans**（既定 2）: 現ページに入る行数 `fit` を、行ごとの実高（ルビ加算込み）+ 閉じる Frame の `bp_end` 予約でシミュレートし、
  `remaining < widows` なら `take = n − idx − widows`、`take < orphans` なら 0（次ページ送り。ページ先頭なら強制配置で進行保証）。
- `breakBefore/After`（`page` / `column` / `odd-page` / `even-page`。連続指定は 1 回に畳む・末尾の空ページは作らない。odd / even は偶奇が合わなければ白ページを挟む）、`keepTogether`（別 Flow で試し組みして高さを測り、入らなければ先に改ページ）、`keepWithNext`（並びと次のブロックを別 Flow で試し組みし、次のブロックの最初の行が同じページに載らず、改ページすれば載るときだけ先に改ページ。試し組みは次のブロックの最初の行を置いた時点で打ち切り、表のセルの最小・最大の長さの計測は同じ組版の中で使い回す）。

## 3. インライン組版 (`inlineLayout.ts`, `jis.ts`)

**Atom 化**: 文字 / ルビ / 縦中横 / 強制改行。字ごとに計測し、カーニング (GPOS の `kernPairs`) と合字 (書体の liga で 1 つの字形になる並びを 1 単位に) は組版側で足すので、Canvas と PDF で同じ位置になる (当初は 1 文字ずつで合字・カーニングを使わなかった)。

**行分割（貪欲 + 禁則）**
1. `x + advance ≤ avail` の間 atom を詰め、溢れる atom `k` に到達。
2. `k` がスペース → 行末に吸収（行末スペースは捨てる）。
3. `k` が 、。 かつ ぶら下げ有効 かつ `k+1` との間が禁則でない → **ぶら下げ**（`k` を行の最後の字のすぐ後ろ (両端揃えの行では版面端) に置き、版面幅は変えない）。
4. **追込み** (JLREQ §3.8.2。詰める処理を空ける処理より優先する): `k` から次の分割点までを、詰めてよい箇所 (欧文の語間 → 行末の約物の後ろのアキ → 中点類の前後 → 行中の括弧・読点のアキ → 和欧間のアキ。§3.8.3 の順と限界、`squeezeParts`。互換モードでは 1 行に二分まで。XSL-FO の仕様モードでは、欧文の語間を詰めるのは両端揃えで組む行だけ = `markWordSqueeze`。互換モードは語間・和欧間を詰めない) を詰めて行に収まるなら、そこまでを 1 行にする。
5. それ以外は **追い出し**: `j = k` から `canBreakAtoms(atoms[j-1], atoms[j])` が真になるまで後退 (戻った分割点より後ろに、ハイフンを付けて収まる分綴の位置があれば、そこで分ける)。後退しきれないとき (行頭に立てられない約物の長い連続) は、先の分割点 (12 字以内) までを約物のアキを詰めて押し込み、それでも入らなければ禁則違反を承知で強制分割。
`canBreakAtoms(a,b)` (`inlineLayout.ts`): 改行の機会は UAX #14 の規則 (`markLineBreaks` が `lineBreak.ts` の規則で字ごとに付ける `lbBefore`。行頭禁則・行末禁則・分離禁止・欧文の語の中を含む) で決め、`white-space: nowrap`・`word-break`・leader の扱いをその前に見る。

**行内配置**: `justify` は「段落の最終行でも強制改行の行でもない行」(最終行は `textAlignLast` があればその揃え。`justify` なら最終行も伸ばす) で、伸ばしてよい字間 (`stretchable`。欧文語内は伸ばさない) に余白を JLREQ §3.8.4 の順に配る (`expandGaps`: 欧文の語間を二分まで → 和欧間を二分まで → ほかの字間を四分まで → それでも余れば均等に。配る量は字の大きさに比例)。`center/end` は先頭オフセット。

**行ボックス**（`lineMetrics`）: 横書きは **ベースライン揃え**（`above = baselineRatio·fs`）、縦書きは **字面中央揃え**（`above = below = fs/2`）。
`baselineRatio` は OS/2 の `typoAscender/upm`（Noto CJK は 0.88）。`em = max(above) + max(below)`、`leading = max(lh − em, 0)`、上下に `leading/2` ずつ配分。

## 4. 縦書きの字形と座標

字の分類 (`jis.ts: verticalTreatment`): 正立 (かな・漢字・全角記号) / 横倒し (欧文・数字・`ー〜…―` 等)。送り長さ（advance）:
全角正立 = `fs`、横倒し欧文 = 水平幅、横倒し全角記号 = `fs`。

GlyphArea の描画原点（Area ローカル、y 下向き）:

```
horizontal : (bx, by) = (0, br·fs)
upright    : (bx, by) = ((fs − naturalW)/2 + dx·fs,  br·fs + dy·fs)
rotate 90° : (bx, by) = ((1 − br)·fs,  (advance − naturalW)/2)      ※原点まわり時計回り 90°
```
`rotate` の導出: 時計回り 90° で `(x,y) → (−y, x)`。em ボックスの y 範囲 `[−br·fs, (1−br)·fs]` は x 範囲 `[−(1−br)·fs, br·fs]` に移るので、原点を `x = (1−br)·fs` に置くと em ボックスが `[0, fs]` に収まる。

- 括弧・読点・句点・`︵︶﹁﹂` 等は、書体の GSUB `vert` の字形を先に使い、無ければ Unicode の **縦書き用字形 (U+FE10–FE48)** にフォントが対応していれば置換（Noto で確認済み）。それも無ければ括弧は横倒し、句読点は `(+0.55em, −0.6em)`、小書き仮名は `(+0.125em, −0.125em)` で補正。
- 行は右→左、文字は上→下。ブロックは右端から左へ積む（上表）。

## 5. ルビ

```
rubySize   = fs · rubyScale (既定 0.5)
advance    = max(baseAdvance, rubyAdvance)                 ← RubyArea の確保長 (inline 方向)
親/ルビ文字 = space-around 均等割り: gap = (advance − Σadv)/n,  x_k = gap/2 + Σ(adv_j + gap)_{j<k}
RubyArea   : bsize = fs + rubyExtent, 親文字 b = rubyExtent, ルビ b = 0   (b=0 が block-start = 横書きなら上・縦書きなら右)
```
**行間アキの調整**: ルビは em ボックスの block-start 側に `rubyExtent` 張り出す。直上の空きは「自行の leadingBefore + 前行の leadingAfter（＋保留マージン）」なので

```
extraBefore = max(0, rubyExtent − leading/2 − adjacentSpace)
行の bsize  = extraBefore + em + leading
```
ルビが空きに収まるなら行送りは変わらず、収まらない分だけ行間が広がる。検証: ルビ無し行 17.0pt／ルビ有り 1 行目 18.5pt（+1.5 = 5 − 3.5）／ルビ連続の 2 行目は 17.0pt。
ルビは前行のハーフレディングへ負の `b` で食い込める（`RubyArea.y < 0`）。
親文字より長いルビは、`rubyOverhang` が有効なら前後の仮名・約物にルビ文字 1 字分まで掛けて (はみ出し。行頭・行末と漢字には掛けない)、その分だけ `advance` を縮める (`inlineLayout.ts: rubyOverhang`)。

## 6. 縦中横

横組みで文字幅 `W = Σ advance` を計測し `scale = min(1, fs/W)`。`scale ≥ 0.5` なら 1 文字枠 (fs × fs) に収め、`scale < 0.5` なら横倒し組みへフォールバック。
縦書き行内の送り長さは常に `fs`。内部グリフは **物理座標を直接指定**（`phys`）:

```
x_k = (fs − W·scale)/2 + Σ(width_j·scale)_{j<k},   y = (advance − fs)/2,   baseline = (0, br·fs),  scaleX = scale
```
「10」→ scale 0.97、「2026」→ 0.448 < 0.5 で横倒しに退避（実測）。PDF では `cm = [sx, 0, 0, 1, …]` で水平圧縮を表現。

## 7. 表 (`layoutTable`)

- 列幅: 固定値の合計を引いた残りを `N*`（`auto` = `1*`）の重みで按分。自動の配置 (CSS の `table-layout: auto`) では、セルの最小・最大の幅を測って列に配る (列をまたぐセルの分も。CSS 2.1 §17.5.2.2)。**列は inline 方向、行は block 方向**に取るので、縦書きの表（行は右→左、セルは上→下）も同じコードで組める。
- 行: 各セルを無改ページの独立 Flow で組み、`行高 = max(セル高)`、全セルの `bsize` を行高に揃える（背景・罫線が行全体を満たす）。`colSpan` 対応。
- 改ページ: 行は原則そのまま次ページへ送る (ページより高い行は、セルの行の境目で分ける。`splitRow`)。`cursor + pending + 行高 > limit` なら `breakPage()`（表自身も Frame なので断片化）→ **ヘッダ行を複製**（`isRepeatedHeader`）→ 行を配置。
  「ページ内容がヘッダだけ」の場合は無限ループ防止のため溢れを許容し警告。

## 7.5 rowSpan

`rowSpan` で結びついた行は **行グループ** (`groupEnd` が連鎖を辿って決定) として 1 単位で組む (ページに入らなければ、行の境目でまたぐ)。

1. グリッド割り付け: `occupiedUntil[col]` に「その列を占有する最終行」を持ち、上から伸びたセルの列を飛ばして各セルの開始列を決める。
2. 各セルを独立 Flow で組んで自然高 `h` を得る。
3. 行高 = その行で始まる `rowSpan = 1` のセルの最大高。`rowSpan > 1` のセルはスパン数の小さい順に、`h − Σ(結合行の高さ)` の不足分を **最終行へ加算**。
4. 結合セルの `bsize = Σ(結合行の高さ)`。開始行の子として持ち、次行以降へはみ出す（縦書きでは左へ伸びる）。

グループ全体が現ページに入らなければグループごと次ページへ送り（ヘッダ複製あり）、ページより高ければ警告して溢れさせる。

## 7.6 fo:leader

`LLeader`（`pattern`: `dots` / `rule` / `space`、`length.minimum/optimum/maximum`）は行内の **伸縮 atom**。

- 行分割では `optimum`（既定 0）で幅を見積もり、**leader の前後では改行しない**（見出しと頁番号を離さない）。
- `positionLine` で、行の残り `free = avail − Σadvance` を leader へ等分配。各 leader を `[min, max]` にクランプし、頭打ちした分は残りの leader へ再配分（最大 4 パス）。
  leader を含む行は均等割付をせず、最終行・強制改行行でも埋める。
- `dots`: 点を **行頭基準のピッチ倍数位置** `x_m = m·pitch` に置く。複数行で点が縦に揃う。縦書きの既定文字は `・`（正立）。
- `rule`: 太さ `ruleThickness` の帯を背景色つきブロックとして出力（中心は、横書きは基線、縦書きは字面中央。太さは上下に等しく付ける）。
  描画は既存のグリフ/背景処理だけで済み、Canvas/PDF レンダラーの変更は不要。

## 7.7 fo:marker / fo:retrieve-marker

- `LMarker{className, children}` はフロー中のどこにでも置け、何も出力しない。段落の途中に置いても行を分断しない（inline run を切らずに保留リストへ積む）。
- **記録するページ**: 保留リスト `markerSink` に積み、次に行・表の行グループ・葉ボックスが実際に置かれた瞬間（改ページ判定の後）に `commitMarkers()` がそのページへ記録する。
  マーカーを持つブロックが次ページへ送られれば、マーカーも次ページに記録される。セル・コンテナ内のマーカーは親 Flow と `markerSink` を共有して親ページへ届く。
- `LRetrieveMarker{className, position, boundary}` は `staticContent` 内で、**全ページの組版が終わった後**（ページ番号置換と同じ二相目）にマーカー内容へ展開される。
  `position`: `first/last-starting-within-page`（そのページで始まるもの）、`first/last-including-carryover`（無ければ前ページからの持ち越し）。
  `boundary`: `page`（持ち越し無し）/ `page-sequence`（既定）/ `document`。
- 展開結果がインラインだけなら `inline` で包み、マーカー自身のスタイルを保つ。ブロックを含む場合は展開先へそのまま並べる。

## 7.8 脚注 (fo:footnote)

`LFootnote{children, label?}`（インライン）。`PageSequence.footnotes`（`FootnoteOptions`）で書式を指定する。実装は `footnotes.ts` と `Flow`。

- **番号**: `FootnoteCtx.label()` が文書順に 1 度だけ採番（`WeakMap` で冪等）。`numberFormat`: decimal / circled / kanji / asterisk、`startNumber`、`labelPrefix/Suffix`、`label` で個別上書き。ページごとのリセット (`reset: 'page'`) は、前回の組版で脚注が置かれたページの中の順番で振り直し、置き場所が変わらなくなるまで組み直す (§7.13 と同じ二相目)。
- **参照記号**: 本文より `referenceScale`（既定 0.7）小さい文字を、block-start 方向へ本文の字の大きさの `0.35em` 持ち上げて出力（横書きは上、縦書きは右。`inlineFlatten.ts` の `flattenFootnoteRef`）。持ち上げ方は `LFootnote.referenceShift` で変えられる（XSL-FO の参照の `baseline-shift`、`--style ah` の HTML では親の字の大きさの 1/3）。記号の前では改行しない（`glue`）。
- **領域の確保**: 脚注領域は region-body の block 方向末尾（横書き=下端 / 縦書き=左端）。確保量 `footReserve = 区切り線 + Σ高さ + 間隔×(n−1)`。本文の改ページ判定は `limit − footReserve` を使う（`room`）。
- **参照行ごと送る**: 行の収まり判定に「その行の脚注の追加分」を含める（`c + h + tail + resv + inc ≤ limit`）。入らなければ行が次ページへ送られ、脚注も一緒に移る。widows/orphans とも整合する。
- **長すぎる脚注**: ページ先頭に強制配置された行の脚注、または 1 つで入りきらない脚注は、行単位で分割（`splitEntry`）し、続きを次ページの脚注領域の先頭へ回す（本文用に 4 割を残す）。最後に残れば脚注だけのページを足す。
- **出力**: 脚注領域は `b = limit − footReserve` の block として region-body の子に追加。物理化で縦書きでは `x = PW − b − w = 0`、つまり左端になる。区切り線は背景色つきのブロック。

## 7.9 float (fo:float)

`LFloat{float: 'start'|'end'|'before', width/height, margin…}`。内容は `buildContainer` と同じ固定ボックスで組む（幅は `width`、縦書きは `height`。既定は本文領域の 1/3、`before` は全幅）。`LBlock.clear` で float の下まで進められる。

- **start / end**: 挿入点 `y = cursor + 保留マージン`（同じ側の直前の float と重ならないよう `max(y, 同側 float の下端)`）に固定し、占有領域 `{side, b0=y, b1=y+外寸, size=inline 外寸}` を記録する。float 自身は `cursor` を消費せず、region の子として `i = margin.is`（start）/ `rootI − margin.ie − isize`（end）に置く。
- **行ごとの幅**: `lineRange(y0, y1)` が、行の block 区間 `[y0, y0+行高)` と重なる float を集め、
  `left = max(content 始端, start の size)`、`right = min(content 終端, rootI − end の size)` とする。
  `shift = left − content 始端`、`width = right − left`。行は `breakOne` で 1 本ずつ切り出し、行ノードを `i = shift` に置く（行の幅は縮み、float の下端を過ぎれば元の幅に戻る）。
  幅が 2em 未満なら、その行は float の下端まで送る。Frame の content-box が region のどこにあるかは `contentIOffset()` で求める。
- **before**: 置き済みの本文を `shiftContent(h)`（root の子・開いている Frame の `startB/contentStartB`・float の `b0/b1`・`cursor` を h だけずらす）で押し下げ、`b = beforeUsed + margin.bs` に積む。縦書きでは block-start = 右端。
- **入らないとき**: 現ページの残りに収まらない float は `deferredFloats` に積み、**次ページの先頭**（`breakPage` の最後）に置く。本文は止まらず先へ進む。ページ先頭でも入らなければ警告して溢れさせる。最後に残れば float だけのページを足す。
- **経路の切替**: 回り込みが有効な間は、行を 1 本ずつ組む経路（`layoutInlineRunFloating`）に入る。ページ跨ぎは行単位で判定し、次のページへ行く行が widows より少なければ、置き済みの行を送り直して widows / orphans を守る (`widowShift`。残りの行数は回り込みの無い幅で数える)。回り込みが無ければ従来の高速経路。
- **制限**: float の位置は入れ子ブロックではなく本文領域（ページ）の端基準。親と直交する書字方向の float (横書きの中の縦書きなど) は、自身の行の長さをページの残りの高さにして組む。float を含む行の脚注、ルビは通常どおり扱う。

## 7.10 行内の箱: 画像 (`LImage`) と `LInlineContainer`

どちらも行分割では「箱 atom」(`kind: 'box'`、前後で禁則なしに改行可) として扱い、寸法は `BoxSpec{adv, cross, above, below}`:

- `adv` = inline 方向の送り、`cross` = block 方向の厚み、`above/below` = 横書きでの、箱の上端/下端から基線までの距離。
- **画像**: 自然なサイズ = 画像の px × 0.75 (96dpi → pt)。片方だけ指定なら縦横比で補い、両方指定なら `min(w/W, h/H)` で枠に収める (`uniform`)。
  横書きは `above = h, below = 0` (下端が基線)。縦書きは `above = below = cross/2` (字面の中央)。画像データが無ければプレースホルダ。大きさは、幅も高さも指定が無ければ 60×40pt、一方だけなら幅:高さ = 3:2 でもう一方を決める（`layoutEngine.ts` の `imageBox`）。
- **inline-container**: `inline-progression-dimension` があればその幅、無ければ shrink-to-fit
  (行幅で組む → 最も長い行 `max(contentLength)` を測る → その幅で組み直す)。内部は独立した Flow (`writing-mode` が親と違ってもよい)。
  横書き同士なら `firstBaseline()` で最初の文字の基線までの距離を求め `above = fb` として、周囲の基線に揃える。
- 行の em の上下 (`lineMetrics`) は箱の `above/below` も含めて max を取るので、背の高い箱は行を押し広げる。
- 描画: `ImageArea` を新設。Canvas は `drawImage`、PDF は PNG/JPEG をそのまま `embedPng/embedJpg` (PNG は IDAT をそのまま FlateDecode の画像に)、他形式 (GIF・BMP・WebP・TIFF など) は PNG に変換して埋め込む (画素を復号して元の大きさの PNG にするか、ブラウザで出力サイズ × 300dpi に描き直す。同じ画像は 1 度だけ)。SVG は `svg.ts` で図形リスト (path を M/L/C/Z に正規化、円弧はベジエに変換、transform は座標に焼き込み) にして、PDF の描画命令として出力する (グラデーションは shading pattern、字は字形の輪郭、mask はソフトマスク)。filter など図形にできないものは、ブラウザではラスタライズし、Node では影・ぼかしを近似して描く (ほかは仮の枠。`BACKLOG.md` O-01)。

## 7.11 背景の層 (`layer: 'behind'`)

リージョン (`region-body` など) やページの背景色は、本文より背面に敷く必要がある。絶対配置コンテナに `layer: 'behind'` を付けると、
`PageArea.behindAreas` に分けて保持され、描画は **behindAreas → 本文 (regionBody) → 前面の絶対配置** の順になる。
ページ全体の背景は `PageMaster.backgroundColor` (塗り足し領域まで塗る)。

## 7.12 箱の回転 (reference-orientation)

回転する箱は、**回転前の局所座標系で組み、描画のときだけ回す**。レイアウトは回転を意識せず、箱の外寸だけが変わる。

- `LNode.rot` (反時計回り 0/90/180/270)。`isize/bsize` は回転前の寸法。**外接矩形** = 90・270 のとき幅と高さが入れ替わる (`bboxOf`)。
  通常フローの消費量・絶対配置の `left/right/top/bottom`・行内の箱の送りは、すべて外接矩形で計算する。
- `Area.width/height` は回転前の局所サイズ、`x/y` は外接矩形の左上、子の座標は局所座標。`Area.orientation` に角度を持つ
  (GlyphArea.rotation は「文字」の回転なので別名にしている)。
- 描画: `paintArea` が局所 → Sheet の変換を `Painter.transform` へ渡す。外接矩形の左上 (x, y)、局所サイズ w × h として
  `90°: [0,−1,1,0, x, y+w]`、`270°: [0,1,−1,0, x+h, y]`、`180°: [−1,0,0,−1, x+w, y+h]` (x' = a·u + c·v + e, y' = b·u + d·v + f)。
  Canvas は `ctx.transform`、PDF は y 反転を含む `G = F∘M∘F⁻¹` (F: y → H − y) = `[a, −b, −c, d, c·H + e, H − d·H − f]` を `cm` で適用する。
  これにより、以降の描画コードは Sheet 座標 (y 下向き) のまま書ける。
- 回転した block-container の幅 (回転前) の既定は、本文領域の block 方向いっぱい (ページの高さ)。
- 本文領域の回転 (`PageMaster.bodyRotation`): 本文領域を回転前の寸法 (縦横入れ替え) で組み、`RegionBodyArea` ごと回す (用紙を横に使う)。
- リージョンの `writing-mode` / `reference-orientation` / `display-align` は、static-content の箱の `writingMode` / `rotation` / `blockAlign` になる
  (回転する場合の局所の幅 = リージョンの長さ、局所の高さ = リージョンの幅)。

## 7.13 条件付きページマスター

`LPageSequence.masterAlternatives`（`fo:page-sequence-master` + `conditional-page-master-reference` 相当）。各要素は `when: {pagePosition, oddOrEven}` と `master`（任意で `staticContent`）を持ち、**先頭から評価して最初に一致したもの**を採用、無ければ `master`。

- ページ番号の偶奇は `initialPageNumber` 基準。`first/rest/only/last/any` はシーケンス内の位置。
- `last`/`only` は総ページ数が要るため、**仮組み → 総数で確定 → 再組み**を最大 3 回繰り返して収束させる（収束しなければ警告）。
- ページごとに本文領域の block 方向サイズ・オフセット・用紙サイズが変えられる（先頭ページだけ天を空ける、ミラー余白など）。
  inline 方向サイズが変わる場合 (幅の違うページマスター) は、改ページの位置で段落の残りを新しい幅で 1 行ずつ組み直す。

## 7.13.1 ページ番号参照の収束

ページ番号参照 (目次・相互参照) があれば、参照先のページ番号が変わらなくなるまで組み直す (最大 4 回)。1 回目は、置き済みの参照先 (後ろから前への参照) はそのページ番号、まだ置いていない参照先はいまのページ番号を仮の値にする (桁数が同じになりやすい)。2 回目以降は、page-sequence ごとに「開始ページ・脚注の続き番号・中で参照した値」が前回と同じなら前回のページをそのまま使い、参照の値が変わっていても字数と字ごとの送りが同じ (桁数が同じ数字など) なら、その字 (`LNode.cite` の印) だけを差し替える。組み直すのは、条件の変わった sequence (ふつうは目次) だけになる。ページごとに脚注番号を振り直す文書は使い回さない。

## 7.14 段組

- `layoutColumnSequence`: 段組のマスターを持つ page-sequence 専用。本文を「段組グループ」と「span=all のブロック」に分け、グループごとに Flow を 1 つ使う。Flow から見ると 1 段 = 1 ページで、`PageHost.nextPage` が次の段 (最後の段なら次ページの 1 段目) の根を返す。
- 段の釣り合わせ: span=all の直前のグループは、(1) 通常どおり試し組みして最終ページ A を知り、(2) A の段の高さを二分探索で縮めた試し組みを繰り返し、A に収まる最小の高さを求め、(3) その高さで本組みする。試し組みは副作用の無い Flow で行う。
- 次のグループ (span ブロック) は、直前グループの最終ページで「最も使った段」の下から始まる。

## 8. PDF 出力 (`pdfRenderer.ts`)

- 座標: `pdfY = sheetH − y`。文字はテキスト行列 `Tm = [sx·cosφ, sx·sinφ, −sinφ, cosφ, P.x, H − P.y]`（`φ = −rotation`）で置く。同じ行列で同じ基線に並ぶ字 (横書きの 1 行、縦書きの横倒しの欧文) は 1 つの `TJ` にまとめ、字の間隔 (字間・両端揃え・カーニング) は字送りの調整 (1/1000 em) で表す。基線の違う字 (縦書きの正立の字など) は字ごとに `Tm` から書く。
- ボックス: `MediaBox = Sheet`、`TrimBox = trimBox`、`BleedBox = bleedBox`、`ArtBox = trimBox`（PDF 座標へ y 反転済み。`pdfinfo -box` で確認）。
- 色: `cmyk(c,m,y,k)` 指定を DeviceCMYK のまま出力（Canvas は RGB 近似）。特色 `spot(濃度,c,m,y,k,名前)` は Separation 色空間 (代わりの色空間は DeviceCMYK、濃度の変換は線形の FunctionType 2) で書く。
- フォント: 使用フォントのみサブセット埋め込み。字は、Area Tree の `GlyphArea.glyphIds` (組版で OpenType の機能 (vert・liga・kern など) を当てて決めた字形の番号) があればそれを符号にして書き、`text` は ToUnicode に使う (無ければ字を書体で組み直す。[`area-tree.md`](area-tree.md))。**`@pdf-lib/fontkit` の TTF サブセットは、グリフデータを 4 バイト境界に揃えず short 形式 loca を書くため、奇数長グリフ以降が化ける**（Noto で再現: 「KUMIORI」が「KU K」になる）。
  `TTFSubset.prototype._addGlyph` をパッチして各グリフを 4 バイトにパディングし、5 ページ全体で 204KB（フルフォント埋め込みなら数 MB）。CFF の OpenType (OTF) は fontkit のサブセットが使えないので、埋め込みを差し替えて CFF の表だけを FontFile3 (CIDFontType0C) に入れ、使わない字の字形を空にした部分書体 (`cff.ts: subsetCff`) にする (CID 方式の CFF は、符号・W・ToUnicode を GID でなく CID で書く)。

## 9. 検証結果

| 項目 | 結果 |
| --- | --- |
| Canvas `measureText` vs fontkit `advanceWidth`（158 字 × 2 書体） | 最大差 **1.7×10⁻⁵ pt** |
| Canvas プレビュー vs PDF ラスタライズ (96dpi, 5 ページ) | インク不一致 1.4–5.5%（大半は CMYK ヘッダ帯の色差） |
| 禁則ファズ (ランダム 240 本 / 1359 行、横・縦) | 行頭禁則違反 9（スペース直後の約物など不正入力のみ）、はみ出し 0、ぶら下げ 99 |
| 改ページ | 断片フラグ・罫線切り取り・widows/orphans・keepTogether・強制改ページを実測確認 |
| 異常系 | 1 ページを超える表の行 → 警告のみで完走、空のフロー → 1 ページ |

## 10. 既知の制限

未対応の機能と既知の制限の一覧は [`BACKLOG.md`](BACKLOG.md) にまとめている (このレポートの各節は、書いた時点の設計の記録なので、その後の実装で解けた制限がある。たとえば、表・コンテナ内の脚注、脚注番号のページごとのリセット、表の行の分割と `border-collapse`、直交する書字方向のブロックの分割、約物の連続のアキ・ルビのオーバーハング・和欧間アキ・カーニングは実装済み)。いまも残る主なもの:

- 禁則の後退でも行頭に立てられない場合 (約物の長い連続) は、先の分割点までを約物のアキで詰めて試し、それでも入らなければ違反を承知で強制分割する。
- 表示用 Canvas は `fontKerning='none'` に固定し、カーニングは組版側の送りで表す (PDF と一致させるため)。
- 回り込み (float) のある段落は行を 1 本ずつ組む経路になり、行グリッドを考慮しない (widows / orphans は、置き済みの行を送り直して守る)。
- 対応していない仕様の項目ごとの説明は、対応仕様説明書 (`docs/conformance/`) の「対応していないもの」の章にある。
