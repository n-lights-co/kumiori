/**
 * Kumiori (組み織り) — データ構造定義
 *
 * 単位はすべて pt (1/72 inch)。ページ設定のみ mm で受け取り units.ts で変換する。
 *
 *   Logical Tree (Input)  ──layoutEngine──▶  Area Tree (Output)
 *   JSON で記述する論理構造         XSL-FO の Area Model に従う物理構造
 *
 * Area Tree の座標規約:
 *   - x, y は「親 Area の content-box 左上」を原点とした、この Area の border-box 左上の位置 (物理座標, y 下向き)
 *   - width, height は border-box の物理サイズ
 *   - margin は border-box の外側の余白であり width/height には含まれない（位置決めにのみ寄与）
 */

/** horizontal-tb (lr-tb) / vertical-rl (tb-rl: 行を右から左へ積む縦書き) / vertical-lr (tb-lr: 行を左から右へ積む縦書き) */
export type WritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
/** 箱の回転 (反時計回りの度数。XSL-FO の reference-orientation と同じ向き) */
export type Rotation = 0 | 90 | 180 | 270;
/** inside / outside は、ページの綴じ側 (奇数ページは左・偶数ページは右) を基準にした start / end。組むページの偶奇で決まる */
export type TextAlign = 'start' | 'center' | 'end' | 'justify' | 'inside' | 'outside';

// ───────────────────────── 共通 Box モデル ─────────────────────────

/** 物理 4 辺 (pt) */
export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 入力用: 数値 1 つなら 4 辺共通 */
export type EdgesInput = number | Partial<Edges>;

/** 百分率と長さの和 (pct は基準に掛ける割合、len は pt)。基準の大きさ b (pt) に対して pct × b + len */
export interface PercentLength {
  pct: number;
  len: number;
}

/** 下線・上線・取り消し線の線の種類 (CSS の text-decoration-style) */
export type TextDecorationStyle = 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';

/** 線種。dot-dash (一点鎖線)・dot-dot-dash (二点鎖線)・wave (波線) はアンテナハウスの拡張 */
export type BorderLineStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'groove' | 'ridge' | 'inset' | 'outset' | 'hidden' | 'dot-dash' | 'dot-dot-dash' | 'wave';

/** 1 辺の罫線 */
export interface BorderSide {
  /** 太さ (pt) */
  width: number;
  /** 色。'transparent' は描かない (太さは取る)。#rrggbbaa (半透明) は、その濃さで下の背景に重ねて描く */
  color: string;
  /** 線種。省略は solid */
  style?: BorderLineStyle;
  /**
   * 破線・点線・鎖線の模様を、辺ごとに辺の中央に対して左右 (上下) 対称に置く (両端の角が同じ形になる。上と下、左と右の辺は同じ模様)。
   * CSS の罫線 (CSS Backgrounds 3 §3.2 の注記は、角が対称になる間隔を勧める)。
   * 無ければ、辺を時計回りにたどり、模様を角をまたいで続ける (XSL-FO の文書)
   */
  symmetric?: boolean;
  /**
   * 波線 (style が wave) の、線の太さと波の 1 周期の長さ (pt)。下線などの飾りの線の波線 (CSS の text-decoration-style: wavy) が付ける。
   * 無ければ、罫線の幅から決める (線は幅の 1/8、周期は幅の約 6 倍)
   */
  waveStroke?: number;
  waveLength?: number;
  /** 表の罫線の重ね合わせ (collapse) で決めた、セルの辺の描き方 (Area Tree の版 2。組版が付ける) */
  collapse?: CollapsedSide;
}

/** 表の罫線の重ね合わせ (collapse) で決めた、セルの辺の描き方 */
export interface CollapsedSide {
  /**
   * 隣のセルと罫線を半分ずつ持つときの、描く線の太さ。width はセルが取る場所 (線の太さの半分)。
   * 線はこの太さで、箱の外へ (paintWidth − width) だけはみ出して描く (グリッド線を中心に描くため)。
   * paintWidth が width より小さいときは、箱の縁から (width − paintWidth) だけ内に描く (表の外周や、互換の組み方の内側の線で、
   * 太さの違う線の中心をそろえるため。場所は、その線のいちばん太い線の半分と、自分の線の半分)
   */
  paintWidth?: number;
  /** 罫線の幅 (width) だけ場所を取り、線は描かない (隣のセルが描く) */
  noPaint?: boolean;
  /** 表の外周にあるセルの辺。角の突き合わせを、表の外の角だけにするのに使う */
  tableEdge?: boolean;
}
/** 入力用: 全辺共通 or 辺ごと */
export type BorderInput = BorderSide | Partial<Record<keyof Edges, BorderSide>>;

/** 箱の 4 辺の罫線 (無い辺は罫線なし) */
export interface BorderStyle {
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
}

/** 継承されるテキストスタイル */
/** 分綴の制限 (TextStyle.hyphenLimits)。どれも無ければ既定 */
export interface HyphenLimits {
  /** 分綴した行の終わりに出す文字列 (空の文字列なら何も出さない)。無ければ既定の字 (U+002D)。ソフトハイフンで分けた行にも使う */
  character?: string;
  /** 分綴する語の最小の字数 (無ければ 5)。ソフトハイフンには、指定したときだけ効く */
  minWord?: number;
  /** 切れ目の前に残す最小の字数 (無ければ 2)。ソフトハイフンには、指定したときだけ効く */
  minBefore?: number;
  /** 切れ目の後 (次の行) に送る最小の字数 (無ければ 2)。ソフトハイフンには、指定したときだけ効く */
  minAfter?: number;
  /** 続けて分綴してよい行の数の上限 (無ければ上限なし。0 は分綴しない)。段落のブロックの値を使う */
  maxLines?: number;
  /** 段落の最後の行の 1 つ前の行 (最後の、行長いっぱいの行) を分綴しない (hyphenate-limit-last: always)。段落のブロックの値を使う */
  noLast?: boolean;
  /** 分綴せずに語を次の行へ送ったときの行末の空きがこの長さ (pt) 以下なら、分綴しない (hyphenate-limit-zone)。段落のブロックの値を使う */
  zone?: number;
  /** zone を行の長さに対する割合 (0〜1) で指定したもの (hyphenate-limit-zone の百分率) */
  zoneRatio?: number;
}

/** 追込みで詰めてよいアキ (TextStyle.textJustifyTrim) */
export interface TextJustifyTrim {
  punctuation: boolean;
  fullStop: boolean;
  middleDot: boolean;
  interWord: boolean;
}

export interface TextStyle {
  fontFamily?: string;
  /** pt */
  fontSize?: number;
  /**
   * fontSize が、作成者の書いた絶対の大きさ (pt・mm やキーワード。% や em ではない)。詰め込み (LBlockContainer.condense) の font-size で、
   * この節とその中身の字の大きさは変えない
   */
  fontSizeFixed?: boolean;
  /**
   * 詰め込みから除く節 (アンテナハウスの拡張の axf:overflow-condense="none" を書いた要素。受け継がない)。外の容器の詰め込み
   * (LBlockContainer.condense) で、この節とその中身の字の大きさ・行の高さは変えない
   */
  condenseNone?: boolean;
  fontWeight?: number;
  /** 下線・上線・取り消し線 (fo の text-decoration)。子へ引き継がれ、false で打ち消す */
  /**
   * 下線・上線・取り消し線。colors は線ごとの色 (線を指定した要素の text-decoration-color。CSS Text Decoration 3 §2.3:
   * 子孫の字の色が違っても、同じ要素から出た線の色は変えない)。無ければ字の色で引く
   */
  textDecoration?: {
    underline?: boolean;
    overline?: boolean;
    lineThrough?: boolean;
    colors?: { underline?: string; overline?: string; lineThrough?: string };
    /** 線ごとの線の種類 (CSS の text-decoration-style。CSS Text Decoration 3 §2.2)。無ければ実線 */
    styles?: { underline?: TextDecorationStyle; overline?: TextDecorationStyle; lineThrough?: TextDecorationStyle };
    /**
     * 線ごとの太さ (pt。CSS の text-decoration-thickness の長さ・百分率。CSS Text Decoration 4 §2.4)。'from-font' は書体の下線の太さ
     * (書体に無ければ、指定の無いときと同じ)。無ければ字の大きさから決める
     */
    thickness?: { underline?: number | 'from-font'; overline?: number | 'from-font'; lineThrough?: number | 'from-font' };
    /**
     * 下線を、基線から外 (字から離れる向き) へずらす量 (pt。CSS の text-underline-offset の長さ・百分率。CSS Text Decoration 4 §2.8)。
     * 線は、その位置から外へ太さの分だけ引く。無ければ字の大きさから決めた位置
     */
    underlineOffset?: number;
  };
  /** 和文と欧文・数字の間にアキを入れる (アンテナハウスの axf:text-autospace・CSS の text-autospace 相当)。既定 false */
  textAutospace?: boolean;
  /** 和欧間のアキの大きさ (字の大きさに対する比)。既定 0.25 (四分)。CSS の text-autospace は 0.125 (CSS Text 4) */
  textAutospaceWidth?: number;
  /**
   * 和欧間のアキで、全角の空白 (U+3000) も和字として扱う (アンテナハウスの axf:text-autospace。XSL-FO が付ける)。
   * CSS の text-autospace は付けない (CSS Text 4 §8.4.1 の表意文字は漢字・仮名などの字で、空白の U+3000 は入らない)
   */
  textAutospaceIdeographicSpace?: boolean;
  /**
   * 和欧間のアキの相手の字を、CSS Text 4 §8.4.1 の定義どおりにする: 一般カテゴリ L・M の字 (non-ideographic letters。ギリシャ・キリル・
   * アラビア・ヘブライ・インド系の字なども) と Nd の字 (non-ideographic numerals)。East_Asian_Width が W・F の字と、縦書きで正立にする字は除く。
   * 無ければ、ラテン文字・数字 (0〜9) と、欧文の書体で組むギリシャ文字・キリル文字の語だけ (XSL-FO の axf:text-autospace と、HTML の互換の指定)。
   * HTML の既定のスタイルの組版が付ける
   */
  textAutospaceUnicode?: boolean;
  /**
   * 両端揃えで字間を空けるとき、約物 (括弧類・句読点・中点類・区切り約物・ハイフン類) と全角の空白の前後も空ける (アンテナハウス互換。
   * --style ah の HTML と XSL-FO の互換モードが付ける)。既定は JLREQ §3.1.11 のとおり、これらの前後は空けない
   */
  justifyPunctuationAh?: boolean;
  /** 約物の連続 (」「 や 。」 など) を詰める (JLREQ §3.1.4)。既定 true */
  punctuationSqueeze?: boolean;
  /**
   * 行の調整 (追込み) で詰める量 (語間・約物のアキ・和欧間のアキの合計) の 1 行あたりの上限 (字の大きさに対する比)。
   * 既定は無制限 (JLREQ §3.8.3)。アンテナハウス互換は 0.5 (二分: 約物 1 つ分までしか追い込まない)
   */
  lineSqueezeMax?: number;
  /**
   * lineSqueezeMax を超えて追い込んでよい行 (アンテナハウス互換の HTML+CSS。--style ah): 詰める量が、その行を追い出したときに
   * 行に残る空き (両端揃えで空ける量) 以下なら、上限を超えても追い込む (inlineLayout の breakOne)
   */
  lineSqueezeBeyondMax?: boolean;
  /**
   * 行の調整 (追込み) で、欧文の語間と、和字と欧字・数字の間の四分アキを詰めない (アンテナハウス互換。XSL-FO の互換モードの既定)。
   * 語間・和欧間のアキは本来の幅より狭くせず (両端揃えの行は広げるだけ)、詰めれば入る字・語は次の行へ送る。
   * 約物のアキの追込みは行う。既定 false (詰める)
   */
  noSpaceSqueeze?: boolean;
  /**
   * 日本語・中国語の文で、全角の字として組むあいまいな字 (Line_Break が AI: ≧・①・※ など) の前後で改行してよい
   * (アンテナハウス互換。XSL-FO の互換モードの既定)。UAX #14 の AI は、東アジアの古い処理系との互換のために ID として扱える。
   * 既定 false (UAX #14 の LB1 の既定どおり AL として扱い、前後の欧字・数字とつなぐ)
   */
  ambiguousWideBreak?: boolean;
  /**
   * 行の調整 (追込み) で詰めてよいアキ (アンテナハウスの拡張 -ah-text-justify-trim・axf:text-justify-trim。継承する)。
   * 無ければ既定 (auto): JLREQ §3.8.3 のとおり、行中の句点類の後ろは詰めない。
   *  - punctuation: 全角の括弧類・中点類・句読点類のアキを詰める。行中の句点類の後ろも詰める (fullStop)
   *  - punctuation-except-fullstop: 句点類 (。．) を除く。punctuation-except-middledot: 中点類 (・：；) を除く (middleDot: false)
   *  - inter-word: 欧文の語間を詰める (アンテナハウス互換の noSpaceSqueeze でも)
   *  - none、または約物の語の無い値: 約物のアキを詰めない (punctuation: false)
   */
  textJustifyTrim?: TextJustifyTrim;
  /**
   * 行の調整 (追込み) で、欧文の語間 (空白) を詰めるのを、両端揃えで組む行だけにする (XSL-FO の仕様モードの既定)。
   * 両端揃えで組まない行 (textAlign が justify でないブロックの行、両端揃えのブロックの最後の行・改行で終わる行で textAlignLast が
   * justify でないもの) の語間は本来の幅のままにし、詰めれば入る字・語は次の行へ送る
   * (XSL 1.1 §7.17.8: word-spacing="normal" の語間は optimum = maximum = minimum。§7.16.9: 字の並びを伸ばしてよいのは justify のとき)。
   * 約物のアキの追込みは、揃えによらず行う。既定 false (どの行でも詰める。wordSpaceShrink が false なら、どの行でも詰めない)
   */
  wordSqueezeJustifiedOnly?: boolean;
  /**
   * 行の調整 (追込み) で、欧文の語間 (空白 1 つ) を詰めてよい量の上限 (pt。継承する)。無ければ空白の字の幅の 1/3 まで。
   * XSL-FO の仕様モードの既定は 0 (詰めない。XSL 1.1 §7.17.8: word-spacing="normal" と <length> は .minimum = .optimum)。
   * word-spacing.minimum の指定があれば、.optimum − .minimum (§7.17.8: .minimum と .maximum が、調整してよい範囲の両端)
   */
  wordSpaceShrinkLimit?: number;
  /**
   * 両端揃えで、欧文の語間 (空白 1 つ) を広げてよい量の上限 (pt。継承する)。無いか 'none' なら上限無し (§7.16.9 の justify の伸び)。
   * XSL-FO の仕様モードで word-spacing.maximum の指定があれば、.maximum − .optimum。'none' は、祖先の上限を打ち消す (上限を書かない指定)
   */
  wordSpaceStretchLimit?: number | 'none';
  /** 行頭の全角の始め括弧類の前の二分アキを詰める (アンテナハウスの axf:punctuation-trim の start)。既定 false */
  punctuationTrimStart?: boolean;
  /**
   * 段落の 1 行目の行頭の始め括弧類・引用符・全角空白を、行の外 (字下げの中) へぶら下げる
   * (CSS Text 3 §8.2.1 の hanging-punctuation: first)。既定 false
   */
  hangFirst?: boolean;
  /** 行末の全角の終わり括弧類・句読点の後ろの二分アキを捨てる (アンテナハウスの axf:punctuation-trim の end。XSL-FO の互換モードの既定) */
  punctuationTrimEnd?: boolean;
  /** 段落の 1 行目の先頭の始め括弧類の前のアキを詰める (段落の途中で折り返した行の先頭は詰めない。XSL-FO の互換モードの既定) */
  punctuationTrimParagraphStart?: boolean;
  /**
   * punctuationTrimStart を、段落の 1 行目と強制改行の直後の行には当てない
   * (アンテナハウスの axf:punctuation-trim の start-except-first)
   */
  punctuationTrimStartExceptFirst?: boolean;
  /**
   * punctuationTrimEnd を、句点 (U+3002 。・U+FF0E ．) には当てない
   * (axf:punctuation-trim の end-except-fullstop。end の詰めから、この 2 字を外したもの。
   * 出どころは、アンテナハウスの公開の説明 ahf-ext.html の axf:punctuation-trim の項)
   */
  punctuationTrimEndExceptFullstop?: boolean;
  /**
   * 全角の括弧類・中点類・句読点類を、行の中のどこでもすべて半角 (二分) にする (axf:punctuation-trim の all)。
   * 始め括弧類は前の二分、終わり括弧類・句読点類は後ろの二分、中点類は前後の四分ずつを詰める
   */
  punctuationTrimAll?: boolean;
  /**
   * 隣り合う全角約物を詰めたときの間隔 (em。axf:punctuation-spacing)。省略時は 0.5 (二分)。
   * 終わり括弧類と始め括弧類の間・終わり括弧類 (句読点を含む) と約物でない字の間・約物でない字と始め括弧類の間を、この値にする
   */
  punctuationSpacing?: number;
  /** 小書き仮名・長音記号 (ー)・繰返し記号 (ゝゞヽヾ々) を行頭に置いてよい (axf:line-break="normal"。XSL-FO の互換モードの既定) */
  looseLineStart?: boolean;
  /**
   * line-break: auto のとき、小書きの仮名・長音記号 (CJ) と繰返し記号の前でも改行する (アンテナハウス互換の HTML。受け継ぐ)。
   * CSS Text 3 §5.2 は auto の決まりを UA に任せる。見本の PDF (CSS-Print 第 4 版) は、行頭に「ー」「ョ」「ゝ」などを置く
   */
  lineBreakAutoAh?: boolean;
  /** 欧文の合字 (fi・fl など) を使う (axf:ligature-mode="latin")。書体が合字の字 (U+FB00〜U+FB04) を持てばその字に、無くても書体の合字の表 (OpenType の liga) で 1 つの字形になる並び (fft・ffk など。語をアイコンにする書体の home・arrow_back なども) は合字にする (横書きで letter-spacing の無いとき) */
  latinLigatures?: boolean;
  /**
   * font-feature-settings で明示して有効にした合字の機能 (liga・clig・dlig・hlig)。字間 (letter-spacing) があっても合字にする
   * (CSS Text 3 §7.2: font-feature-settings で指定した合字は、字間のあるときに任意の合字を当てない決まりより優先する。Fonts 4 §7.2 の順)
   */
  forcedLigatures?: string[];
  /**
   * 行の高さの決め方 (XSL-FO の line-stacking-strategy)。max-height (既定): 行の高さは line-height と字面の高さの大きい方。
   * line-height: 行の高さは line-height そのもの (字面より小さければ、字が行の外へはみ出す。数式のアクセントなどに使う)
   */
  lineStackingStrategy?: 'max-height' | 'line-height' | 'font-height';
  /**
   * 行の高さを XSL 1.1 §4.5 の規則で決める (ブロックの字の高さの矩形と、行の中の各 inline の矩形を囲み、
   * ブロックの line-height から求めた半行間を上下に足す)。省略時は従来の決め方 (互換 (AH) モデル)
   */
  xslLineStacking?: boolean;
  /**
   * letter-spacing を XSL 1.1 §7.17.2 の規則で空ける: Alphabetic の字の前後に半分ずつ。行頭・行末の分は捨てる。
   * 省略時は CSS と同じく、すべての字の後ろに空ける
   */
  xslLetterSpacing?: boolean;
  /** 行の高さを超える箱 (画像など) の行にも、ブロックの半行間を上下に空ける (XSL §4.5 の max-height。XSL-FO の文書) */
  boxLineHalfLeading?: boolean;
  /**
   * 行の高さの寄与を、最初に使える書体 (first available font) の字の上下だけで決め、代わりの書体の字の上下は使わない
   * (CSS Inline 3 §5.3: line-height が normal でないとき。https://www.w3.org/TR/2024/WD-css-inline-3-20241218/ 、2026-11-04 取得)。HTML の文書
   */
  primaryFontMetrics?: boolean;
  /**
   * 行内の箱 (背景・罫線・padding つきの inline、リンクの範囲) の内容の領域を、その inline の最初に使える書体の上の高さ・下の深さ
   * (hhea の ascent・descent。OS/2 の typo の上下が 1em を成す和文の書体は、その値 = em の箱) で決める。横書きは基線の上に ascent・下に descent、
   * 縦書きは中央の基線を挟んで (ascent + descent) / 2 ずつ。代わりの書体の字・中の inline の字の大きさは数えない。行の高さには関わらない
   * (CSS 2.1 §10.6.1: 内容の領域の高さは書体に基づき、決め方は UA に任される。CSS Inline 3 §6.4 の inline-sizing: normal:
   * 最初に使える書体の字に合う大きさ。https://www.w3.org/TR/2024/WD-css-inline-3-20241218/ 、2026-11-11 取得)。HTML の文書。
   * 無ければ、中の字の大きさの箱 (em の箱) を囲む (XSL-FO の文書・API から直接組む文書)
   */
  inlineBoxFontMetrics?: boolean;
  /**
   * 横書きの行の中の基線を、最初に使える書体の上の高さ・下の深さ (hhea の ascent・descent) で置く: 行内の箱 (高さ = line-height) の上端から
   * 基線までは (line-height + A − D) / 2 (CSS Inline 3 §5.3 の A′ = A + L/2、L = line-height − (A + D)。CSS 2.1 §10.8.1。
   * fontManager.ts の cssBaselineRatio)。行の高さ (行送り) は変わらない。縦書きの行は、中央の基線 (行の中央) のまま。HTML の文書。
   * 無ければ、書体の em の箱の比 (LoadedFont.baselineRatio。OS/2 の表のある書体は 0.88、typo の上下が 1em の和文の書体はその値) で置く
   * (XSL-FO の文書・API から直接組む文書・アンテナハウス互換の HTML の文書 (htmlImport.ts の emBoxBaselineAh))
   */
  fontBaseline?: boolean;
  /**
   * line-height: normal の行で、既定の書体 (読み込んでいない書体: Noto Serif JP・Tinos・Cousine など) が代わりの書体として使われたときも、
   * その書体の上下 (hhea の ascent・descent と行間) を行の高さに数える (CSS Inline 3 §5.3。fontManager.ts の normalLineBounds)。
   * ブラウザの既定のスタイル (--style browser・browser-margin) の HTML の文書 (HtmlImportOptions.normalLineHeightAllFonts)。
   * 無ければ、読み込んだ書体 (LoadedFont.metricsLineHeight) だけを数える
   */
  normalLineHeightAllFonts?: boolean;
  /**
   * アンテナハウス互換 (primaryFontMetrics の行): 最初に使える書体を、空白の字の書体でなく、言語 (lang) が日本語・中国語・韓国語なら
   * 和文の字 (国) の書体とする (font-family: source-sans-pro, … の lang="ja" の行の基準線は、和文の書体の上下で決まる)
   */
  primaryFontByLang?: boolean;
  /**
   * 行に支柱 (strut) を入れない (CSS の display: block の画像を包むブロック。行の箱が無いので、画像の下に字の下がりを空けない)。
   * HTML の互換モード・限定互換モードの文書も (Quirks Mode Standard §3.4 の blocks ignore line-height quirk)
   */
  noStrut?: boolean;
  /**
   * HTML の互換モード・限定互換モード: 中身の無い行内の箱 (幅 0 の目印) と空白だけの字は、行の高さの計算で line-height を 0 とみなす
   * (Quirks Mode Standard §3.3 の line height calculation quirk。https://quirks.spec.whatwg.org/ 、2026-11-04 取得)
   */
  lineHeightQuirk?: boolean;
  /**
   * ブロックの字より大きい字のある行の高さを、XSL §4.5 の max-height の規則で決める (字の大きさの箱を囲み、ブロックの半行間を上下に足す)。
   * 互換モードの XSL-FO の文書 (line-stacking-strategy="max-height")
   */
  blockLeadingMaxHeight?: boolean;
  /** 行末の空白を残す (white-space-treatment が preserve・ignore-if-after-linefeed。XSL §7.16.8) */
  keepLineEndSpace?: boolean;
  /** 空白を詰める (CSS の white-space が normal・nowrap・pre-line)。強制改行の後の行頭の空白を取り除く (CSS Text 3 §4.1.2) */
  collapseSpaces?: boolean;
  /** 上付き・下付き (baseline-shift) の字で行を広げるか (fo の line-height-shift-adjustment)。既定 consider-shifts (広げる) */
  lineHeightShiftAdjustment?: 'consider-shifts' | 'disregard-shifts';
  /** 参照領域 (ページ・段・ブロックコンテナ) の最初の行の上の半行間を捨てる (fo の line-height.conditionality="discard"。XSL §7.16.4) */
  lineHeightDiscard?: boolean;
  /**
   * 隣り合う行の半行間の重ね合わせの優先度 (fo の line-height.precedence。XSL §7.16.4・§4.3.1)。'force' (既定) は上下の半行間を足し、
   * 数は優先度の高い方 (同じなら大きい方) だけを残す
   */
  lineHeightPrecedence?: number | 'force';
  /**
   * 行の高さを、字ごとの書体の上下の高さ (ascent・descent) に line-height を割り振って決める (CSS と同じ)。
   * 上下の比率の違う書体 (明朝と Times など) が混ざる行は、わずかに高くなる。既定 false (どの字も em の箱で揃える)。
   * XSL-FO の互換モード (compat: 'antenna') の文書では、ブロックと同じ書体の指定の字を、字形を取った書体ではなくブロックの nominal-font
   * (XSL 1.1 §5.5.7) の上下の高さで割り振る (和文と欧文の混じる行も行送りは line-height のまま。欧文だけの行の基線も和文の行と同じ)
   */
  fontLineMetrics?: boolean;
  /** 欧文の語を、分綴の位置で行末にハイフンを付けて分ける (fo の hyphenate)。分綴の位置は LayoutOptions.hyphenate で求める */
  hyphenate?: boolean;
  /** 言語 (xml:lang / language。分綴の規則を選ぶ)。例 en, en-US */
  language?: string;
  /**
   * 分綴の制限 (CSS Text 4 §6.3.2〜§6.3.5 の hyphenate-character・hyphenate-limit-*、XSL 1.1 §7.10.5〜§7.10.7・§7.16.2 の
   * hyphenation-character・hyphenation-push/remain-character-count・hyphenation-ladder-count)。継承される (指定した組がまるごと子へ伝わる)。
   * 無ければ既定 (行末の字は U+002D、語は 5 字以上・切れ目の前後は 2 字以上、行の数の上限なし)
   */
  hyphenLimits?: HyphenLimits;
  /** ルビが親文字より長いとき、前後の仮名・約物に掛ける (ルビ文字 1 字分まで。JLREQ §3.3.8)。既定 false */
  rubyOverhang?: boolean;
  /**
   * 親文字・ルビが、その箱 (親文字とルビのうち長いほうの長さ) より短いときの、字の配り方 (CSS Ruby 1 §4.3 の ruby-align)。継承する。
   * ルビ (LRuby) に付けたときは、その注釈 (rubyText) の配り方 (親文字と 2 段目は rubyAlignBase・rubyAlignUnder。無ければ、まわりから継承した値)。
   * 無ければ、字ごとに前後に同じアキを付ける (欧文の字の間も空ける。XSL-FO の入力の既定)。HTML の入力の既定は 'space-around' (§4.3 の初期値)
   */
  rubyAlign?: RubyAlign;
  /** 欧文のペアカーニング (フォントの kern / GPOS)。横書きのみ。既定 false */
  kerning?: boolean;
  /**
   * 書体に無い字形を作ってよいか (CSS Fonts 4 §2.8 の font-synthesis-weight・-style・-small-caps。継承する)。
   * false: 太字の無い書体を太らせない・斜体の無い書体を傾けない (font-synthesis-style: oblique-only の italic も)・small caps の字形の無い書体で
   * 大文字を縮めて代わりにしない。既定 (undefined) は作る
   */
  synthesizeWeight?: boolean;
  synthesizeStyle?: boolean;
  synthesizeSmallCaps?: boolean;
  /**
   * 欧文の語間 (空白) を、行が僅かに溢れるとき本来の幅より詰めて、語を行に収めてよいか。既定 true。
   * false なら語間は本来の幅より詰めない (ブラウザ・CSS と同じ。両端揃えでは広げるだけ)
   */
  wordSpaceShrink?: boolean;
  /**
   * 字形を差し替える OpenType の機能 (例: onum = 小文字に合わせた数字、smcp、tnum)。横書きのみ。子へ引き継がれる。
   * 字ごとに書体の機能を当てた字形で測り、描く (画面は字形の輪郭、PDF は機能を付けて埋め込んだ書体)
   */
  fontFeatures?: string[];
  /**
   * 色つきの字形のパレット (CSS の font-palette。CSS Fonts 4 §9.1)。normal (既定のパレット)・light・dark か、
   * 名前に当たる @font-palette-values の規則の並び (colorGlyph.ts の FontPaletteStyle)。子へ引き継がれる
   */
  fontPalette?: import('./colorGlyph').FontPaletteStyle;
  /** 縦書きの字の向き (CSS の text-orientation。Writing Modes 3 §5.1)。mixed は UAX #50 の Vertical_Orientation で決める */
  textOrientation?: 'mixed' | 'upright' | 'sideways';
  /** 行の中の向き。rtl は右から左 (writing-mode="rl-tb")。欧文・数字の並びは左から右のまま。子へ引き継がれる */
  direction?: 'ltr' | 'rtl';
  /**
   * 双方向のテキストの埋め込み・上書き・隔離 (CSS の unicode-bidi。Writing Modes 3 §2.2・XSL 1.1 §7.29.6)。子へ引き継がれない。
   * inline では、中身の前後に双方向の制御文字を入れたものとして並べる (Writing Modes 3 §2.4.2)。
   * block では、bidi-override・isolate-override は中身の全体を上書きし、plaintext は段落の向きを最初の強い字で決める
   */
  unicodeBidi?: 'embed' | 'isolate' | 'bidi-override' | 'isolate-override' | 'plaintext';
  /** 改訂バー (アンテナハウスの axf:revision-bar-*)。この要素の文字を含む行の脇に線を引く。子へ引き継がれる */
  revisionBar?: RevisionBar;
  /**
   * 変更バー (XSL 1.1 の fo:change-bar-begin〜fo:change-bar-end。§6.13.2)。この要素の文字を含む行の脇に、並びのすべての線を引く
   * (入れ子・重なった変更バー)。子へ引き継がれる。空の並びは、親から引き継いだものを消す
   */
  changeBars?: RevisionBar[];
  /** 行番号 (アンテナハウスの axf:line-number-*)。子へ引き継がれ、子の指定は親の指定に重ねる */
  lineNumber?: LineNumbering;
  /**
   * 字幅の伸縮 (font-stretch。1 = normal、0.75 = condensed)。幅の軸 (wdth) を持つ可変フォントは、その軸の値にする (CSS Fonts 4 §2.3)。
   * 幅の違う書体 (幅の狭い・広い書体のファイル) を読み込んだファミリーは、求める幅に最も近い書体を選ぶ (§5.2)。
   * 幅の違う書体の無いファミリーは、横書きの字形を水平に拡縮する
   */
  fontStretch?: number;
  /**
   * 斜体。傾きの軸 (ital・slnt) を持つ可変フォントは、その軸の値にする (CSS Fonts 4 §2.4・§5.2)。
   * 斜体・斜めの書体 (書体のファイル・@font-face の font-style) を読み込んだファミリーは、その書体で組む (§5.2)。
   * 斜体の書体の無いファミリーは、描画時に傾斜 (疑似斜体) をかける
   */
  fontStyle?: 'italic' | 'normal';
  /**
   * font-style: oblique の角度 (度。時計回りが正)。fontStyle が 'italic' のときに、italic でなく oblique <角度> であることを表す
   * (可変フォントの slnt の軸の値を決める。軸の無い書体では、italic と同じ疑似斜体)。fontStyle と一緒に指定し、一緒に引き継がれる
   */
  fontObliqueAngle?: number;
  /** 可変フォントの軸の値 (CSS の font-variation-settings。札 → 値。CSS Fonts 4 §8.2)。子へ引き継がれる。空は normal */
  fontVariationSettings?: Record<string, number>;
  /** 可変フォントの光学サイズの軸 (opsz) を、字の大きさに合わせるか (CSS の font-optical-sizing。§8.1)。既定は auto。子へ引き継がれる */
  fontOpticalSizing?: 'auto' | 'none';
  /**
   * 光学サイズの軸 (opsz) に渡す、字の大きさの単位。既定は 'pt' (opsz の尺度は pt。OpenType の Design-variation axis tag registry)。
   * 'px' は CSS px の数 (pt の 96/72 倍)。HTML + CSS の文書は 'px' (CSS Fonts 4 §8.1 の試験 variable-opsz.html: font-size の px の数が opsz になる)。
   * 子へ引き継がれる
   */
  fontOpticalSizeUnit?: 'pt' | 'px';
  /** 行送り比 (fontSize × lineHeight が 1 行の block 方向サイズ)。比のまま継承される */
  lineHeight?: number;
  /**
   * lineHeight が、CSS の line-height: normal から決めた値か (HTML の入力が付ける。lineHeight には、最初に使える書体の normal の比を入れる)。
   * true の字のうち、代わりの書体 (最初に使える書体でない、読み込んだ書体) で組まれた字は、その書体の上下も行の高さに数える (CSS Inline 3 §5.3)。
   * 子へ引き継がれ、子が lineHeight・lineHeightPt を指定し直すと外れる
   */
  lineHeightNormal?: boolean;
  /**
   * 行送りの長さ (pt)。指定すると lineHeight より優先し、子の文字サイズが違っても同じ長さのまま継承される
   * (XSL 1.1 §7.16.4: 長さ・百分率で指定した line-height は計算済みの長さで継承される)
   */
  lineHeightPt?: number;
  color?: string;
  textAlign?: TextAlign;
  /** 最終行 (と強制改行の直前の行) の揃え。省略時は textAlign に従い、justify のときだけ start (fo の relative) */
  textAlignLast?: TextAlign;
  /** 強制改行のほかは行を折り返さない (fo の wrap-option="no-wrap")。はみ出した分はそのまま */
  noWrap?: boolean;
  /**
   * 行の並べ方の選び方 (CSS の text-wrap-style。CSS Text 4 §5.4)。継承する。balance: 行の長さをそろえる。
   * pretty (avoid-short-last-line も同じ扱い): 100 行までの段落は、段落全体を見て行を分ける (最後の行が短すぎないように)。100 行を超える段落は、
   * 1 行ずつ先から決め、最後の行が短いときだけ、終わりの数行を分け直す。auto (stable も) は、1 行ずつ先から決める (既定)。行を持つブロックの値で決める
   */
  textWrapStyle?: 'auto' | 'balance' | 'pretty';
  /**
   * 行に収まらない中身も、text-align の center・end でそろえる (はみ出した分を始めの側へ出す)。
   * CSS のリストの外側の目印 (::marker の箱は、項目の始めの端の外に置かれ、長ければ外へはみ出す。CSS Lists 3 §3.5) に使う
   */
  alignOverflow?: boolean;
  /**
   * 収まらない語の扱い (CSS の overflow-wrap。Text 3 §5.5)。normal: 語の中では分けず、はみ出す。break-word・anywhere: 語の途中で分ける。
   * 省略時は語の途中で分ける (XSL-FO)
   */
  overflowWrap?: 'normal' | 'break-word' | 'anywhere';
  /** 語の中の改行 (CSS の word-break。Text 3 §5.2)。break-all: 字と字の間でも改行してよい。keep-all: 字と字の間 (和文を含む) では改行しない */
  wordBreak?: 'normal' | 'break-all' | 'keep-all';
  /** 改行の厳しさ (CSS の line-break。Text 3 §5.2)。auto は normal と同じ。指定が無ければ、strict (looseLineStart があれば、その緩め方) */
  lineBreak?: 'auto' | 'strict' | 'normal' | 'loose' | 'anywhere';
  /** 強制改行の後の行を、その側の回り込みの下から始める (HTML の br の clear。CSS 2.1 §9.5.2 の行内の clear) */
  breakClear?: 'start' | 'end' | 'both';
  /** 字下げ (pt)。1 行目の inline-start 側 */
  textIndent?: number;
  /**
   * 最後の行の、行の終わりの端の字下げ (pt。XSL 1.1 §7.16.3 の last-line-end-indent)。行内の並びの最後の行 (ブロックの最後の行と、
   * 子のブロックの前で終わる行) の終わりの端を、正の値で内へ、負の値で外へずらす。子へ引き継がれる。
   * 目次の行で、折り返した行は end-indent の手前で終え、ページ番号のある最後の行だけを端まで伸ばすのに使う
   */
  lastLineEndIndent?: number;
  /** 字下げを掛ける行を逆にする (1 行目以外を字下げする。CSS の text-indent の hanging。Text 3 §8.1) */
  textIndentHanging?: boolean;
  /** 強制改行の後の行も、1 行目と同じに扱う (CSS の text-indent の each-line。Text 3 §8.1) */
  textIndentEachLine?: boolean;
  /** 字間 (pt) */
  letterSpacing?: number;
  /** 語間 (CSS の word-spacing。pt)。語を分ける字 (空白・ノーブレークスペース) の幅に足す */
  wordSpacing?: number;
  /**
   * タブ位置の間隔 (CSS の tab-size。CSS Text 3 §4.2)。数は、段落のブロックの空白の字 (U+0020) の送り (字間・語間を足したもの) の何倍か、
   * { length } は長さ (pt)。省略は 8。残したタブ (空白を詰めない書式の中の U+0009) は、ブロックの内容の端から数えた次のタブ位置まで進む。0 なら進まない
   */
  tabSize?: number | { length: number };
  /** 字間が値で指定されている (fo の letter-spacing が normal 以外)。両端揃えでも字間を伸縮せず、行は左 (start) に詰める */
  fixedLetterSpacing?: boolean;
  /** fixedLetterSpacing のとき、両端揃えで字間を広げてよい上限 (pt, 1 字間あたり)。letter-spacing.maximum − .optimum。無ければ広げない */
  letterSpacingStretch?: number;
  /** ルビ文字サイズ比 (fontSize に対する比。既定 0.5) */
  rubyScale?: number;
  /** ぶら下げ組み (行末の 、。 を行からはみ出して配置) 既定 true */
  hangingPunctuation?: boolean;
  /** orphans / widows (既定 2) */
  orphans?: number;
  widows?: number;
}

/** すべての論理ノード共通 */
/**
 * 強制改ページの種類 (fo の break-before / break-after)。column: 次の段 (段組でなければ次のページ)、
 * odd-page / even-page: 次の奇数 / 偶数ページ (偶奇が合わなければ白ページを挟む)
 */
export type BreakKind = 'page' | 'column' | 'odd-page' | 'even-page';

export interface BaseNode extends TextStyle {
  id?: string;
  /**
   * タグ付き PDF の構造の節の番号 (LDocument.structure の位置。structure.ts)。読み込みが、構造の木を作るとき (HtmlImportOptions.tagged) だけ付ける。
   * 構造を持たない包みの箱も、中身の入る構造の節 (いちばん近い祖先の要素のもの) の番号を持つ
   */
  tag?: number;
  writingMode?: WritingMode;
  /**
   * 描くときだけに効く効果 (CSS の transform・opacity)。組版 (箱の位置・大きさ・ページ分け) には関わらない。
   * 組んだ後で、この節から作った Area に transform・opacity として付ける (paintEffect.ts)
   */
  paintEffect?: PaintEffect;
}

/** 変換の長さ: pt か、基準の箱の幅 (横)・高さ (縦) に対する百分率 */
export type TransformLength = number | `${number}%`;

/**
 * 変換の関数 1 つ (CSS Transforms 1 §9.1 の 2D の関数)。translateX・scaleY などは、translate・scale にして持つ (§9.2)。
 * 角度は度 (時計回りが正。y は下向き)。matrix の e・f は pt
 */
export type TransformFunction =
  | { fn: 'matrix'; m: [number, number, number, number, number, number] }
  | { fn: 'translate'; x: TransformLength; y: TransformLength }
  | { fn: 'scale'; x: number; y: number }
  | { fn: 'rotate'; deg: number }
  | { fn: 'skew'; x: number; y: number };

/**
 * 輪郭線 (CSS の outline。CSS UI 4 §3)。罫線の箱の外側に、offset だけ離して (負の値は内側へ) 描く線。場所を取らず、ほかの箱を動かさない。
 * 4 辺とも同じ太さ・線種・色 (§3.1 の注記: 辺ごとの指定は無い)
 */
export interface Outline {
  /** 太さ (pt) */
  width: number;
  /** 色。#rrggbbaa (半透明) は、その濃さで重ねて描く */
  color: string;
  /** 線種。省略は solid (hidden は無い。§3.3) */
  style?: Exclude<BorderLineStyle, 'hidden' | 'dot-dash' | 'dot-dot-dash' | 'wave'>;
  /** 罫線の箱の端から輪郭線の内側までの距離 (pt。outline-offset。負の値は箱の内側へ。省略は 0) */
  offset?: number;
}

/** 描くときだけに効く効果 (BaseNode.paintEffect) */
export interface PaintEffect {
  /**
   * 変換 (CSS の transform と、translate・rotate・scale)。functions は左から掛ける (§3)。origin は変換の原点 (transform-origin。
   * 基準の箱の左上から。無ければ中央 50% 50%)。box は基準の箱 (transform-box。無ければ border の箱)。
   * ページ・段で分かれた箱は、断片ごとに、その断片の箱を基準に変換する (CSS Fragmentation 3 §5.5)
   */
  transform?: { functions: TransformFunction[]; origin?: [TransformLength, TransformLength]; box?: 'content-box' };
  /** 不透明度 (CSS の opacity。0〜1)。箱とその中身をまとめて 1 枚の絵にしてから、この濃さで重ねる (CSS Color 4 §3.3) */
  opacity?: number;
  /**
   * 輪郭線 (CSS の outline。CSS UI 4 §3)。この節の箱 (ページ・段で分かれた箱は断片ごと) の罫線の箱の外側に描く。
   * 行内の箱 (LInline) の輪郭線は、LInline.outline に書く (行ごとの断片に描く)
   */
  outline?: Outline;
  /**
   * 切り抜きの矩形 (CSS の clip: rect(top, right, bottom, left)。CSS 2.1 §11.1.2・CSS Masking 1 付録 A)。絶対配置の箱だけ。
   * 4 つの値は、箱の罫線の箱の左上からの距離 (pt。right・bottom も、左・上の端から測る)。無い辺は auto (罫線の箱のその辺)。
   * この節の箱の中身 (背景・罫線・輪郭線・子孫) を、この矩形で切り抜く
   */
  clip?: { top?: number; right?: number; bottom?: number; left?: number };
}

/**
 * XSL-FO の writing-mode (XSL 1.1 §7.29.7) のうち、横書き・縦書き (と右から左) で組んだ後に、軸を裏返して表すもの。
 * block: 行・ブロックを積む向きを逆に (lr-bt・rl-bt と alternating・inverting の -bt)。inline: 行の中の向きを逆に (bt-lr・bt-rl。下から上へ)。
 * alternate: 偶数行を、逆の向きに並べる (reverse。lr-alternating-*) か、180 度回す (invert。lr-inverting-*)。
 * pairs: 2 字ずつ横に組んだ組を縦に積む (tb-lr-in-lr-pairs。縦中横で表す)。{} は「この箱で書字方向を決め直した」の印 (外の裏返しを中へ持ち込まない)
 */
export interface WritingFlip {
  block?: boolean;
  inline?: boolean;
  alternate?: 'reverse' | 'invert';
  pairs?: boolean;
}

/** 背景画像 (fo の background-image / background-repeat / background-position) */
export interface BackgroundImage {
  src: string;
  /** 既定 repeat */
  repeat?: 'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y';
  /** 位置。キーワード・pt・百分率 ("50%")。既定 0 (左・上) */
  x?: number | 'left' | 'center' | 'right' | `${number}%`;
  y?: number | 'top' | 'center' | 'bottom' | `${number}%`;
  /** x・y の長さ (pt) を、右の端・下の端から内側への距離とする (CSS の background-position: right 10px bottom 20px) */
  xFromEnd?: boolean;
  yFromEnd?: boolean;
  /** 百分率の位置 (x・y) に足す長さ (pt。CSS の background-position: calc(50% + 10px) の長さの部分。CSS Values 4 §10.11) */
  xOffset?: number;
  yOffset?: number;
  /** 画像の大きさ (pt)。省略は画像本来の大きさ (px × 0.75) */
  width?: number;
  height?: number;
  /**
   * background-size の百分率 (0〜1 の割合)。背景の配置の領域 (padding box) の幅・高さに対する割合で、組版で箱の大きさが決まってから
   * width・height にする (CSS Backgrounds 3 §2.9)。片方だけのときは、もう片方を画像の縦横比 (aspect = 幅 / 高さ) で決める
   */
  widthPct?: number;
  heightPct?: number;
  /** 百分率の大きさに足す長さ (pt。CSS の background-size: calc(50% + 10px) の長さの部分) */
  widthOffset?: number;
  heightOffset?: number;
  /** 百分率のとき、auto の (縦横比で決める) ほう */
  pctAuto?: 'width' | 'height';
  aspect?: number;
  /** cover: 箱を覆う最小の大きさ / contain: 箱に収まる最大の大きさ (縦横比を保つ。width / height より優先。CSS の background-size) */
  size?: 'cover' | 'contain';
  /**
   * CSS のグラデーション (linear-gradient() などの関数の文字列。CSS Images 3 §3)。組版で箱の大きさが決まったら、
   * その大きさの SVG の画像にして src に入れる (cssGradient.ts)。大きさの指定が無ければ背景の領域 (padding box) の大きさ
   */
  gradient?: string;
  /** グラデーションの em の基準 (pt) */
  gradientFontSize?: number;
  /**
   * 位置の基準の領域 (CSS の background-origin。Backgrounds 3 §2.8)。無ければ padding の箱。位置・百分率の大きさ・繰り返しの始まりを、
   * この領域で決める
   */
  origin?: 'border-box' | 'content-box';
  /**
   * 描く範囲 (CSS の background-clip。Backgrounds 3 §2.7)。無ければ padding の箱 (罫線の下には描かない。XSL-FO の背景: XSL 1.1 §4.9.4)。HTML の読み込みは、初期値 border-box もそのまま渡す。border-box は border の箱 (罫線の下も)、
   * content-box は内容の箱。角丸の箱では、その箱の角丸で切り抜く
   */
  clip?: 'border-box' | 'content-box';
  /** この画像の後ろに重ねる画像 (CSS の複数の背景。Backgrounds 3 §2.1)。手前のものから順。それぞれが位置・大きさ・繰り返し・origin・clip を持つ */
  under?: BackgroundImage[];
}

/**
 * 枠の中での画像の位置 (CSS の object-position。<position>)。x・y は、長さ (pt。枠の左・上の端から画像の左・上の端まで) か、
 * 百分率 ((枠の大きさ − 画像の大きさ) に対する割合。50% は中央)。xFromEnd・yFromEnd は、長さを右・下の端からの距離とする
 */
export interface ObjectPosition {
  x: number | `${number}%`;
  y: number | `${number}%`;
  xFromEnd?: boolean;
  yFromEnd?: boolean;
  /** 百分率の位置に足す長さ (pt。object-position: calc(50% + 10px) の長さの部分) */
  xOffset?: number;
  yOffset?: number;
}

/** 角丸 (アンテナハウスの axf:border-radius)。四隅を半径 rx (水平)・ry (垂直) の楕円で丸める */
export interface BorderRadius {
  rx: number;
  ry: number;
  /**
   * 角ごとの半径 (左上・右上・右下・左下の順に [水平, 垂直])。あれば rx・ry より優先する (CSS の border-*-radius)。
   * 百分率は箱の幅 (水平)・高さ (垂直) に対して。{ pct, len } は百分率と長さの和 (CSS の calc(10% + 5pt))。
   * 隣り合う半径の和が辺より長ければ、すべてを同じ比で縮める
   */
  corners?: Array<[RadiusLength, RadiusLength]>;
}

/** 角の半径: 長さ (pt)、百分率、百分率 (pct。10% なら 10) と長さ (len。pt) の和 */
export type RadiusLength = number | `${number}%` | { pct: number; len: number };

/** 影 (axf:box-shadow・CSS の box-shadow)。ぼかしは、少しずつ太らせた半透明の形の重ねで表す */
export interface BoxShadow {
  dx: number;
  dy: number;
  color: string;
  /** ぼかしの幅 (CSS の blur radius。σ はその半分) */
  blur?: number;
  /** 広がり (形を太らせる量) */
  spread?: number;
  /** 不透明度 (色の alpha。既定 1) */
  opacity?: number;
  /** 内側の影 (CSS の inset)。padding の箱の内側に描く */
  inset?: boolean;
}

export interface BoxStyle {
  /** block 方向の内容の寸法の最小値 (pt。XSL の block-progression-dimension.minimum)。中身が少なくても、この高さを取る */
  minBlockSize?: number;
  /**
   * ページ・段で分かれた断片の切れ目でも、前側 (before) / 後ろ側 (after) の罫線・余白 (padding) を残す
   * (XSL の border-before-width.conditionality="retain" など。初期値 discard では切れ目で 0 にする §4.3.1)
   */
  edgeRetain?: { borderBefore?: boolean; paddingBefore?: boolean; borderAfter?: boolean; paddingAfter?: boolean };
  margin?: EdgesInput;
  padding?: EdgesInput;
  border?: BorderInput;
  backgroundColor?: string;
  backgroundImage?: BackgroundImage;
  /**
   * 背景の色を塗る範囲 (CSS の background-clip のうち、いちばん後ろの層の値。Backgrounds 3 §2.2)。無ければ border の箱。
   * ブロック・表・セル・絶対配置の箱と、罫線・余白を持つ行内の箱 (inline) の背景で効く
   */
  backgroundClip?: 'padding-box' | 'content-box';
  borderRadius?: BorderRadius;
  /** 影。複数なら、先のものが上に描かれる (CSS と同じ) */
  boxShadow?: BoxShadow | BoxShadow[];
  /** 対角罫: 箱の before-start の角から after-end の角へ引く線 (アンテナハウスの axf:diagonal-border-*) */
  diagonalBorder?: BorderSide;
  /** 逆対角罫: before-end の角から after-start の角へ引く線 (axf:reverse-diagonal-border-*) */
  reverseDiagonalBorder?: BorderSide;
  /**
   * space-before / space-after の優先度 (XSL 1.1 §4.3.1)。隣り合う余白は、force があれば force の合計、
   * 無ければ優先度の最も高いものの中で最大のものだけが残る。既定 0
   */
  spaceBeforePrecedence?: number | 'force';
  spaceAfterPrecedence?: number | 'force';
  /** 段・ページの先頭に来ても space-before (margin の block-start 側) を捨てない (space-before.conditionality="retain") */
  retainSpaceBefore?: boolean;
  /**
   * 段・ページの終わりに来ても space-after (margin の block-end 側) を捨てない (space-after.conditionality="retain"。XSL-FO の仕様モード
   * では margin-bottom などから来る space-after も retain。§5.3.2)。段落の最後の行は、この余白まで含めて入る場合だけ置く
   */
  retainSpaceAfter?: boolean;
  /** 物理サイズ (pt)。既定は content-box 基準。未指定は auto */
  width?: number;
  height?: number;
  /**
   * width・height のうち、読み込みのときに包含ブロックの大きさの見積もりから長さにしたもの (HTML の百分率の指定と、auto の幅を
   * max-width・min-width で抑えたもの)。中身の幅を測る組版 (min-content・max-content) では、その向きの大きさを auto として扱い
   * (CSS Sizing 3 §5.2.1)、max・min (pt。width・height と同じ box-sizing の箱の長さの上限・下限) で抑える (§5.1)。
   * auto は、指定が auto の大きさ (上限・下限で抑えた見積もり): 組むときも、置く場所の大きさを max・min で抑えた大きさにする (CSS 2.1 §10.4)
   */
  estimatedSize?: { width?: { auto?: boolean; max?: number; min?: number }; height?: { auto?: boolean; max?: number; min?: number } };
  /**
   * 包含ブロックの幅に対する百分率で指定した寸法 (HTML の CSS。百分率と長さの和の calc() も)。読み込みのときは、包含ブロックの幅の
   * 見積もりから長さにして width・margin などに入れてあり、組版エンジンは、箱を置くときの実際の包含ブロックの inline の大きさで
   * 解き直して、それに代える (CSS 2.1 §10.2・§10.4・§8.3・§8.4。margin・padding は上下も包含ブロックの inline の大きさが基準:
   * CSS Writing Modes 4 §7.2)。width・minWidth・maxWidth は、横書きの流れの中の箱の物理の幅 (どれかが百分率なら、長さで書いたものも
   * pct 0 で入れる。width が無ければ auto)。textIndent は、箱の内容の幅が基準 (CSS Text 3 §8.1)。中身の幅を測る組版で、基準が
   * 測る幅によるときは、幅は auto、上限は none、下限・margin・padding・textIndent は百分率の部分を 0 として解く (CSS Sizing 3 §5.2.1)
   */
  percent?: {
    width?: PercentLength;
    minWidth?: PercentLength;
    maxWidth?: PercentLength;
    margin?: Partial<Record<keyof Edges, PercentLength>>;
    padding?: Partial<Record<keyof Edges, PercentLength>>;
    textIndent?: PercentLength;
  };
  /**
   * 幅の決まったブロックの、auto の左右の余白の向き (CSS 2.1 §10.3.3)。組むときに、置く場所の残りを 'center' は左右に等分、
   * 'end' は終わり側、'start' は始まり側の余白に足す (包含ブロックの幅が読み込みのときに分からない flex の項目の中などで使う)
   */
  autoMargins?: 'start' | 'center' | 'end';
  /** はみ出した内容の扱い (fo の overflow)。hidden: padding の外端で切り抜く。既定 visible */
  overflow?: 'visible' | 'hidden';
  /** width/height の基準。'border-box' なら padding・border を含めた寸法 (既定 'content-box') */
  boxSizing?: 'content-box' | 'border-box';
  /**
   * 縦横比 (CSS の aspect-ratio。幅 / 高さ。CSS Sizing 4 §5.1)。高さが auto の箱で、組むときの実際の幅 (box-sizing の箱) から
   * 高さを決める。scroll なしの箱 (overflow: visible) は中身で伸びる (自動の最小の大きさ。§5.1)、切り抜く箱は比の高さで固定
   */
  aspectRatio?: number;
  /**
   * block 方向の内容の寸法の最大値 (pt。max-height)。aspect-ratio の箱では、比から出した大きさを抑える (CSS Sizing 4 §5.1)。
   * 高さが中身で決まる横書きの段組の箱では、段の取れる高さの上限にする (箱の高さは抑えない。CSS Multi-column 1 §7.1)
   */
  maxBlockSize?: number;
  /** inline 方向の内容の寸法の最小値・最大値 (pt。横書きの min-width・max-width。aspect-ratio の箱でだけ使う。CSS Sizing 4 §5.1) */
  minInlineSize?: number;
  maxInlineSize?: number;
  /**
   * 内容による inline 方向の大きさ (CSS Sizing 3 §3.2 の min-content・max-content・fit-content)。size は大きさ (横書きの width・縦書きの height)、
   * min・max はその下限・上限 (min-width・max-width)。組むときに、中身の幅を測って決める (§2.1・§5.1)。これがある箱では、長さで指定した
   * 下限・上限 (minInlineSize・maxInlineSize) も、組むときに当てる
   */
  inlineSizing?: { size?: ContentSizeKeyword; min?: ContentSizeKeyword; max?: ContentSizeKeyword };
}

/**
 * 内容による大きさ (CSS Sizing 3 §3.2 の語)。{ fit } は fit-content(<長さ>) (CSS Sizing 4 §3.2: fit-content の式の「使える長さ」を、
 * この長さ (pt。内容の箱の大きさ) に置き換える)
 */
export type ContentSizeKeyword = 'min-content' | 'max-content' | 'fit-content' | { fit: number };

// ───────────────────────── ページ設定 ─────────────────────────

export interface PageMaster {
  /** 仕上がりサイズ (mm) */
  width: number;
  height: number;
  /** 塗り足し幅 (mm) */
  bleed: number;
  /** トンボを出力するか */
  trimMarks: boolean;
  /** トンボ領域の幅 (mm)。既定 10 */
  trimMarkMargin?: number;
  /** トンボ領域の幅を辺ごとに (mm。塗り足しの外側から紙の端まで)。trimMarkMargin より優先 */
  trimMarkMargins?: { top: number; right: number; bottom: number; left: number };
  /** 角のトンボ (既定 true) とセンタートンボ (既定 true) を描くか */
  cornerMarks?: boolean;
  centerMarks?: boolean;
  /** トンボの線の太さ (pt。既定 0.3) */
  trimMarkLineWidth?: number;
  /** 本文領域 (region-body) の余白 (mm) */
  margins: { top: number; right: number; bottom: number; left: number };
  /**
   * 余白の箱を置く、ページの余白 (mm。CSS の @page の margin)。@page に padding があるときだけ (margins は margin に padding を足したもの)。
   * 無ければ margins を使う
   */
  marginBoxMargins?: { top: number; right: number; bottom: number; left: number };
  /**
   * 段組 (fo:region-body の column-count / column-gap)。gap は mm (既定 12pt)。
   * 脚注と前方 float は、既定 (footnotePosition='page') ではページ全体 (全段を貫く) に置き、'column' なら段ごとに置く (axf:footnote-position)。
   */
  columns?: {
    count: number;
    gap?: number;
    footnotePosition?: 'page' | 'column';
    /** 段と段の間の罫線 (axf:column-rule) */
    rule?: BorderSide;
    /** balance: フローの末尾の段も釣り合わせる (既定は span の直前だけ。末尾は順に埋める) */
    fill?: 'balance' | 'auto';
  };
  /**
   * 傍注の領域 (アンテナハウスの axf:footnote-position="outside")。本文領域の内容の左端からの位置 x と幅 (mm)。
   * 奇数ページは end (右)、偶数ページは start (左) の領域に置く。そのページの領域が無ければ、ふだんの脚注
   */
  sideNotes?: { start?: { x: number; width: number }; end?: { x: number; width: number } };
  /** 本文領域 (region-body) の回転。用紙を横に使うときなど。本文は回転後の寸法で組み、描画時に回す */
  bodyRotation?: Rotation;
  /** ページ全体の背景 (塗り足しまで届く)。ブロックの背景とは別 */
  backgroundColor?: string;
  /** ページ全体の背景画像 (塗り足しを含む範囲に、背景色の上・本文の下に描く。CSS の @page・根元の要素の背景) */
  backgroundImage?: BackgroundImage;
  /**
   * 背景色・背景画像を描く範囲。既定 page は用紙全体 (塗り足しまで)。content はページの余白の内側 (本文の領域) だけに描き、
   * 背景画像の位置・cover / contain もその範囲に対して決める (CSS の根元の要素 (html・body) の背景。WeasyPrint と同じ)
   */
  backgroundArea?: 'page' | 'content';
  /**
   * 背景画像の位置の基準の領域 (仕上がりの各辺から内側への幅、mm)。CSS の @page の背景は、塗り足しまでのページの箱の全体に描くが、
   * 位置・百分率の大きさ・cover / contain・繰り返しの並べ始めは、ページの箱の padding の領域 (余白と罫線の内側) で決める (CSS Paged Media 3 §3.1)。
   * 無ければ、描く範囲 (塗り足しを含む用紙の全体か、backgroundArea が content なら本文の領域) で決める
   */
  backgroundOrigin?: { top: number; right: number; bottom: number; left: number };
}

// ───────────────────────── 論理ツリー (Input) ─────────────────────────

/** PDF の文書情報 (fo の axf:document-info) */
export interface DocumentInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

/** しおり (PDF のアウトライン。fo:bookmark-tree / fo:bookmark) */
export interface LBookmark {
  title: string;
  /** 飛び先の要素の id */
  ref: string;
  /** 文書の外への飛び先 (XSL-FO の fo:bookmark の external-destination。XSL 1.1 §7.23.6)。ref が空のときだけ使う (§6.11.2) */
  href?: string;
  /** 子のしおりを開いた状態で表示する (既定 true) */
  open?: boolean;
  children?: LBookmark[];
}

export interface LDocument extends BaseNode {
  type: 'document';
  title?: string;
  info?: DocumentInfo;
  bookmarks?: LBookmark[];
  /** タグ付き PDF の構造の木 (structure.ts。0 番が文書)。読み込みが構造の木を作るとき (HtmlImportOptions.tagged) だけある */
  structure?: import('./structure').StructNode[];
  sequences: LPageSequence[];
  /**
   * 隣り合う余白 (space / margin) の解決の規則。
   * 'xsl': XSL 1.1 §4.3.1 (同じ優先度の中で最も大きい値。符号も含めて比べる)。
   * 省略: CSS の margin の相殺 (正の最大と負の最小の和)
   */
  spaceResolution?: 'xsl';
  /**
   * 中身の無い目印 (<span id="…"></span> など) だけの行を、マージンの相殺を断つものとして扱う (WeasyPrint の組み方。HtmlImportOptions.idLinesSeparateMarginsWp)。
   * 省略: CSS 2.1 §9.4.2 のとおり、その行は無いものとして扱い、前後のマージンを相殺する
   */
  idLinesSeparateMargins?: boolean;
  /** 見つからないページ番号の参照 (target-counter()) を空にする (WeasyPrint の組み方。HtmlImportOptions.unresolvedCitationEmptyWp)。省略: 「?」 */
  unresolvedCitationEmpty?: boolean;
  /**
   * ページの左右 (条件付きのマスターの oddOrEven・odd-page と even-page の区切り・force-page-count の end-on-even と end-on-odd・
   * 綴じ側と小口側) を、ページ番号の偶奇でなく、文書の最初からのページの順 (何枚目か。白ページも 1 枚と数える) の偶奇で決める
   * (CSS の組み方。CSS Paged Media 3 §3.3: 左右のページは交互に来て、最初のページの左右はページの進む向きで決まる。§6.1 の page の
   * カウンターは、番号の表示のためのもの)。odd は、順が奇数のページ (左から右へ進む文書の右ページ)。
   * 省略: ページ番号の偶奇 (XSL 1.1 §6.4.11 の odd-or-even。XSL-FO と、HTML の互換のスタイル)
   */
  pageSidesByOrder?: boolean;
  /**
   * 索引の鍵の付いた所 (XSL-FO の index-key・fo:index-range-begin〜-end。XSL 1.1 §6.10・§7.24)。文書の中の順に並べる。
   * LIndexPageCitationList が、ここに並んだ所の置かれたページを引く。無ければ索引を使わない文書
   */
  indexEntries?: LIndexEntry[];
}

/**
 * 索引の鍵の付いた所 1 つ (XSL 1.1 §7.24.2 index-key)。id (と endId) の要素が置かれたページを、id のページの記録
 * (リンク先・しおり・ページ番号の参照と同じ仕組み) から引く
 */
export interface LIndexEntry {
  /** 索引の鍵 (index-key) */
  key: string;
  /** 索引の分類 (index-class。§7.24.1)。省略は空の文字列の分類。分類の違うページは、範囲にまとめない */
  indexClass?: string;
  /** 鍵の付いた要素の id (文書の中の飛び先にもなる)。範囲では、始まりの印の id */
  id: string;
  /**
   * 終わりの印の id。指定すると、id の最初のページから endId の最後のページまでを引く (fo:index-range-begin〜fo:index-range-end。
   * 行内の要素がページをまたぐときの、終わりの位置にも使う)。省略は、id の要素の領域のある最初のページから最後のページまで
   */
  endId?: string;
  /**
   * 明示の範囲 (fo:index-range-begin。§6.10.4)。同じページを引く項目が重なったとき、範囲のものを残す (§6.10.6)。
   * endId が無ければ、文書の最後のページまで (組になる fo:index-range-end が無いときの回復)
   */
  range?: boolean;
  /**
   * 領域を作らない目印 (中身の無い fo:wrapper・fo:index-range-begin)。ブロックの間など、行を作らない所に置かれたときは、
   * 次の内容が置かれるページを引く (§6.10.6。後ろに内容が無ければ、前の内容のページ)
   */
  point?: boolean;
}

/** fo:conditional-page-master-reference 相当の条件 */
export interface PageMasterCondition {
  /** first: 先頭ページ / last: 最終ページ / only: 1 ページだけの場合 / rest: first・last 以外 / any (既定) */
  pagePosition?: 'first' | 'rest' | 'last' | 'only' | 'any';
  /** 白ページ (改ページの偶奇合わせ・force-page-count で足したページ) かどうか (fo の blank-or-not-blank) */
  blankOrNotBlank?: 'blank' | 'not-blank' | 'any';
  /** true なら、ページシーケンスの末尾に足した白ページ (force-page-count・次のシーケンスの左右合わせ) だけに当てる (途中の改ページで入る白ページには当てない) */
  trailingBlank?: boolean;
  /** ページ番号の偶奇 (initialPageNumber を考慮)。LDocument.pageSidesByOrder のときは、文書の最初からのページの順の偶奇 */
  oddOrEven?: 'odd' | 'even' | 'any';
}

export interface ConditionalPageMaster {
  when: PageMasterCondition;
  master: PageMaster;
  /** 指定すると、このマスターのページでは PageSequence.staticContent の代わりに使う ([] でヘッダー等を無しにできる) */
  staticContent?: LBlockContainer[];
}

/**
 * fo:page-sequence-master の部分列 (§6.4.8-6.4.11)。先頭から順に、それぞれの最大ページ数ぶん使う。
 * single: 1 ページ / repeatable: maxRepeats ページ (省略で無制限) / alternatives: 条件で選ぶ (maxRepeats ページ)
 */
export interface PageMasterSequenceItem {
  kind: 'single' | 'repeatable' | 'alternatives';
  maxRepeats?: number;
  /** single / repeatable は 1 つ。alternatives は条件の順に評価 */
  masters: ConditionalPageMaster[];
}

export interface LPageSequence extends BaseNode {
  type: 'page-sequence';
  /** 本文 (region-body) の書字方向の裏返し (XSL-FO の bt-lr・lr-bt など。WritingFlip) */
  writingFlip?: WritingFlip;
  /**
   * 最初のページの先頭でも、ブロックの space-before を捨てる (retain の指定は残す)。XSL-FO (§4.3 の conditionality) では、
   * 参照領域の先頭の space は、最初のページでも捨てる。CSS は最初のページの先頭の余白を残すので、HTML では使わない
   */
  discardLeadingSpace?: boolean;
  /**
   * 1 段の本文でも、流れの直下のブロックの span (LBlock.span) が切り替わる所で、参照領域を分ける (アンテナハウス互換)。
   * 境では、前のブロックの space-after と次のブロックの space-before を相殺せず、参照領域の端の余白として解決する (XSL 1.1 §4.3.1:
   * conditionality="discard" の余白は捨て、retain の余白は残す)。絶対配置の箱 (LBlockContainer.areaOffset) は、分けた領域の先頭を基準にする。
   * 段組の本文 (PageMaster.columns) は、discardLeadingSpace のとき、いつも span の切り替わりで領域を分ける (§6.4.14)
   */
  spanAreas?: boolean;
  /** 既定のページマスター (alternatives のどれにも一致しないページで使う) */
  master: PageMaster;
  /** ページマスターの部分列 (page-sequence-master)。指定すると masterAlternatives より優先 */
  masterSequence?: PageMasterSequenceItem[];
  /**
   * 条件付きページマスター。先頭から順に評価し、最初に一致したものを採用する。
   * 各マスターの本文領域の inline 方向サイズは master と同じにすること (異なる場合は警告)。
   */
  masterAlternatives?: ConditionalPageMaster[];
  /** 脚注の書式 (脚注を使う場合に指定) */
  footnotes?: FootnoteOptions;
  /** 前方 float (float="before") と本文の間に置く内容 (xsl-before-float-separator)。前方 float のある段・ページだけに出る */
  beforeFloatSeparator?: Array<LBlockLevel | LInlineLevel>;
  /** 全ページに繰り返し配置される絶対配置要素 (ヘッダー等)。{pageNumber} {totalPages} を置換 */
  staticContent?: LBlockContainer[];
  flow: LFlow;
  /** 1 ページ目のページ番号 (既定 1) */
  /** 先頭ページの番号。auto-odd / auto-even: 前の続きの番号が偶数 / 奇数なら 1 足す (白ページは挟まない) */
  initialPageNumber?: number | 'auto-odd' | 'auto-even';
  /**
   * ページ番号の書式 (fo の format。"1" "01" "i" "I" "a" "A" "１" "一" と前後の文字)。既定は 10 進数。
   * 桁区切り (fo の grouping-separator・grouping-size) は、withGrouping (pageNumber.ts) で書式に付ける
   */
  pageNumberFormat?: string;
  /** ページ番号の前後の字 (fo:folio-prefix・fo:folio-suffix) を持つ page-sequence の番号。索引のページ番号 (LIndexKeyReference.folios) が引く */
  folioKey?: number;
  /**
   * ページ数の調整 (fo の force-page-count)。足りなければ末尾に白ページを足す。既定 auto:
   * 次の page-sequence の initialPageNumber が数値なら、それに続くよう最後のページの偶奇を合わせる
   */
  forcePageCount?: 'auto' | 'even' | 'odd' | 'end-on-even' | 'end-on-odd' | 'no-force' | number;
}

export interface LFlow extends BaseNode {
  type: 'flow';
  children: LBlockLevel[];
}

export type LBlockLevel = LBlock | LTable | LBlockContainer | LMarker | LRetrieveMarker | LRetrieveTableMarker | LFloat;
export type LInlineLevel = string | LInline | LRuby | LTateChuYoko | LLeader | LFootnote | LPageNumberCitation | LImage | LInlineContainer | LFootnoteCitation | LIndexPageCitationList;

/** 脚注本体の中で、その脚注の番号 (自動連番のラベル) に置き換わる (アンテナハウスの axf:footnote-number-citation) */
export interface LFootnoteCitation {
  type: 'footnote-citation';
}

export interface LBlock extends BaseNode, BoxStyle {
  type: 'block';
  /**
   * 親と書字方向が直交するブロック (横書きの flex の行の中の縦書きの項目など) の block の大きさ (親の行の向きの大きさ) を、
   * 置く場所の幅いっぱいにする (flex の項目の主軸の大きさは、列の幅。Flexbox 1 §9.7)。中身の幅を測るときは効かない
   */
  fillOrthogonal?: boolean;
  /**
   * 支柱だけの箱 (flex の項目の visibility: collapse。Flexbox 1 §4.4): 中身は描かず (字・リンク・しおりも出さない)、
   * 子 (畳む前の行を組んだ表) を測るだけ組んで、その block の大きさの空の箱を置く
   */
  phantom?: boolean;
  /** 支柱だけの箱の中に、リンクの飛び先として残す id */
  phantomIds?: string[];
  /**
   * 新しいブロック整形文脈を作る (CSS の display: flow-root・overflow が visible 以外。CSS 2.1 §9.4.1)。
   * 中の子の余白を箱の余白と畳まず、箱の高さは中の float を含む (§10.6.7)
   */
  bfc?: boolean;
  /**
   * 中の絶対配置の箱 (positionInContainer) の基準になる (CSS の position が static でない箱。CSS 2.1 §10.1)。
   * 中の箱は、この箱を組み終えてから、この箱の内容の箱の左上・右下からの距離 (left・top・right・bottom) で置く。
   * top・bottom が無ければ、置かれるはずだった高さ (static position)。ページをまたいだ箱では、top は最初の断片、bottom は最後の断片が基準
   */
  containingBlock?: boolean;
  /** CSS の position: relative のずらし (pt。右・下が正)。組んだ後の箱 (すべての断片) を動かし、前後の配置は変えない (CSS 2.1 §9.4.3) */
  relativeOffset?: { x: number; y: number };
  /** リンク (ブロックを含む fo:basic-link) */
  link?: LinkTarget;
  /**
   * 高さの決まった箱 (block-container) の子として、箱の中の余った高さを分けてもらう比 (縦並びの flex の項目の flex-grow。Flexbox 1 §9.7)。
   * 余りは比で分けて子の箱を伸ばし、後ろの子を下げる
   */
  flexGrow?: number;
  /**
   * 高さの決まった箱の子として、前 (before)・後 (after) の余白が auto (縦並びの flex の項目の margin-top・margin-bottom: auto。Flexbox 1 §8.1)。
   * flexGrow の子が無ければ、余った高さを auto の余白の数で等分して空ける
   */
  flexAutoMargin?: { before?: boolean; after?: boolean };
  /**
   * 高さの決まった箱の子として、中身が箱に入りきらないときに縮める比 (縦並びの flex の項目の flex-shrink。Flexbox 1 §9.7)。
   * 縮める量は flexShrink × 箱の高さの比で分け、flexMin (pt。枠・内側の余白を含む) より小さくしない。flexMin が無ければ中身の高さ
   * (min-height: auto の自動の最小の大きさ。§4.5)
   */
  flexShrink?: number;
  flexMin?: number;
  /** 縦並びの flex の折り返しの容器 (LBlockContainer.flexWrapColumns) の子として、列の幅まで広げる (align-items: stretch) */
  flexWrapStretch?: boolean;
  /** 同じく、列の中の寄せ方 (広げない子。align-items・align-self の start・center・end) */
  flexWrapAlign?: 'start' | 'center' | 'end';
  /** PDF の注釈 (ブロックの最初の断片の左上から) */
  annotation?: Annotation;
  /** ブロック子 or インライン子。混在時は連続するインライン列が匿名ブロックになる */
  children: Array<LBlockLevel | LInlineLevel>;
  /** 前後の強制改ページ */
  breakBefore?: BreakKind;
  breakAfter?: BreakKind;
  /** 段組の本文で、フローの直下に置いたときに全段を貫く (fo:block の span="all")。直前までの段は釣り合わせる */
  span?: 'all';
  /**
   * 段組のコンテナの中で、span="all" の前後で分けたブロックの、2 つ目からの断片 (XSL-FO)。断片の中の最初の行は、ブロックの最初の行では
   * ないので、text-indent を当てない (XSL 1.1 §7.16.11: 字下げするのは、ブロックの最初の領域の最初の行だけ)
   */
  spanContinued?: boolean;
  /** ブロック内の改ページを禁止 (可能な限り) */
  keepTogether?: boolean;
  /**
   * keepTogether のブロックが、前の keep-with-next の並び (ページの先頭から始まる) と同じページに入らないとき、次のページへ送らずに
   * 並びの後ろに置き、分けずにページの下へはみ出させる (アンテナハウス互換)。省略時は、ブロックだけを次のページへ送る
   * (前の並びとの keep-with-next を破る)
   */
  keepOverflow?: boolean;
  /** 次のブロックの先頭と同じページに置く (見出しの孤立防止)。次が先頭行だけでも同じページに入ればよい */
  keepWithNext?: boolean;
  /** 直前のブロックの末尾と同じページに置く (直前のブロックに keepWithNext を付けるのと同じ) */
  keepWithPrevious?: boolean;
  /** 回り込み (float) の下へ回り込ませず、指定側の float が終わるまで下げる */
  clear?: 'start' | 'end' | 'both';
  /**
   * 行グリッド (アンテナハウスの axf:baseline-grid / -ah-baseline-grid)。new: この箱の字の大きさと line-height で作る。
   * root: 根元の書式で作る。none: 解除する。中の行のベースラインを行グリッドの位置に揃える。
   * 行グリッドの中では行の前後に半行間を空けず、字の仮想ボディ (em の箱) を前の行の em の箱に続けて、基線を次の格子に載せる。
   * 行グリッドを作った箱の内容の上端・下端は、最初・最後の行の em の箱の端 (最後の行の後ろに半行間を空けない)
   */
  baselineGrid?: 'new' | 'root' | 'none';
  /**
   * 行グリッド (baselineGrid の new) の中の行を格子に載せず、em の箱を前の行の em の箱にそのまま続けて積む
   * (半行間を空けない決まりは同じ)。アンテナハウス互換の、行グリッドの表のセルの中身 (見本の PDF: CSS-Print 第 4 版の
   * table { line-height: 21q; -ah-baseline-grid: new } の、折り返したセルの行の送りは字の大きさ。21q の格子に載せない)
   */
  baselineGridStack?: boolean;
}

export interface LInline extends BaseNode {
  type: 'inline';
  children: LInlineLevel[];
  /** 絶対配置の箱 (LBlockContainer.inlineCb が同じ番号のもの) の基準になる行内の箱の番号 */
  cbKey?: number;
  /**
   * 行の中で見つけた絶対配置の箱の、見つけた所の目印 (組版が段落の並びに入れる、中身の無い inline。読み込みも、行内の要素の中の
   * ページを基準にする箱に、負の番号で付ける: LBlockContainer.inlineAnchor)。
   * 幅 0 の箱 (LNode.absAnchor が同じ番号) になり、組んだ後で、その箱の位置を static position にする (CSS 2.1 §10.3.7・§10.6.4)
   */
  staticAnchor?: number;
  /**
   * タグ付き PDF: 行内の要素の中の絶対配置の箱を書いた所の目印 (読み込みが、中身の無い inline に付ける。staticAnchor の目印のときは付けない)。
   * 幅 0 の箱になり、構造の木で、その箱の要素の構造の節を、ここに置く (箱は後で描くが、読む順は書いた所。ISO 32000-1 §14.8.2.3)。
   * 目印の inline には、その要素の構造の節の番号 (tag) が付く
   */
  structMark?: boolean;
  /**
   * 行の中に書いた CSS の float の、書いた所の目印 (中身の無い inline。読み込みが、行内の要素の中の float を行内の要素の外へ出すとき
   * (LFloat.inlineAnchor) と、組版が、段落の並びの途中の float を見つけたときに入れる)。幅 0 の箱になり、組版は、この目印を含む行を組む
   * ときに float を置く (CSS 2.1 §9.5.1 の規則 6・8: float の上端は、float より前の中身を含む行の上端より上にしない。そのうえでできるだけ上)
   */
  floatAnchor?: number;
  /** 行を分ける改行 (children は '\n')。行頭 (空の行になるとき) では無視する (行内の要素のブロックの ::before / ::after) */
  softBreak?: boolean;
  /**
   * font-variant-caps の small-caps (small) / all-small-caps (all)。書体が smcp (all は c2sc も) を持てばその字形を使い、
   * 持たなければ小文字 (all は大文字も) を、字の大きさの 0.7 倍の大文字で代わりに組む (Fonts 4 §6.6 の合成)
   */
  smallCaps?: 'small' | 'all';
  /** インライン背景 (ハイライト) */
  backgroundColor?: string;
  /** 背景の色を塗る範囲 (無ければ border の箱。BoxStyle.backgroundClip と同じ。XSL-FO の fo:inline は、罫線の下が見える箱だけ padding の箱) */
  backgroundClip?: 'padding-box' | 'content-box';
  /**
   * 中身の無い行内要素 (CSS)。幅 0 で、自分の字の大きさと line-height の高さを行の箱に入れる (CSS 2.1 §10.8)。
   * 字も余白・罫線も無い行だけになるときは、行を作らない (§9.4.2)
   */
  emptyStrut?: boolean;
  /**
   * CSS の ::first-line: この inline の書式は、ブロックの最初の行の字だけに当てる (2 行目からは中身だけ。CSS 2.1 §5.12.1)。
   * ブロックの最初の行内の並びを包む
   */
  firstLine?: boolean;
  /** 行の途中で分割しない (fo の keep-together.within-line="always") */
  noBreak?: boolean;
  /**
   * 割注 (JLREQ §3.4。Kumiori の拡張の、CSS の -kumiori-warichu・XSL-FO の kumiori:warichu)。中身を、この inline の字の大きさで 2 行に割って、
   * 本文の行の中に入れる (warichu.ts)
   */
  warichu?: LWarichu;
  /** ベースラインからの上げ下げ (super / sub / pt。正が上)。文字サイズは別に fontSize で指定する */
  baselineShift?: 'super' | 'sub' | number;
  /**
   * CSS の vertical-align のキーワード (置き換えでない行内の箱。CSS 2.1 §10.8.1。横書きの行だけ)。行内の箱は、line-height の高さの箱
   * (最初に使える書体の上下に半行間を足したもの):
   *  - top・bottom: その要素と中身 (aligned subtree) の箱の上端・下端を、行の箱の上端・下端にそろえる
   *  - middle: 箱の上下の中央を、親の基線から親の x-height の半分だけ上にそろえる
   *  - text-top・text-bottom: 箱の上端・下端を、親の内容の領域の上端・下端にそろえる
   */
  verticalAlign?: 'top' | 'bottom' | 'middle' | 'text-top' | 'text-bottom';
  /** 文字を囲む罫線・内側の余白 (fo:inline の border / padding)。行をまたぐときは、切れ目の辺は描かない */
  border?: BorderInput;
  padding?: EdgesInput;
  /** 行をまたぐ枠の切れ目にも、罫線・内側の余白を付ける (CSS の box-decoration-break: clone。CSS Fragmentation 3 §5.4) */
  boxDecorationBreak?: 'clone';
  /** 角丸 (CSS の border-radius)。枠の罫線と背景を丸め、中の画像も内側の角丸で切り抜く */
  borderRadius?: BorderRadius;
  /**
   * 輪郭線 (CSS の outline。CSS UI 4 §3)。行ごとの断片のそれぞれを、閉じた線で囲む (行の高さ・字の位置は変えない)。
   * 罫線・余白のある箱は罫線の箱の外側、無い箱は内容の領域の外側に描く
   */
  outline?: Outline;
  /**
   * 外側の空き (pt)。行の進む方向の始端 (start) と終端 (end) に、枠の外の空白を置く (CSS の inline 要素の左右の margin)。
   * bound: 空きを、箱の最初の字・最後の字と分けない (CSS の margin。行を分けるのは箱の margin の端の外。CSS 2.1 §9.4.2・CSS Text 3 §5.5)。
   * 無ければ、空きと字の間でも行を分けられる (XSL-FO の space-start・space-end のこれまでの扱い)。
   * dropStartAtWrap: 折り返した行の先頭に来た、始まりの側の空きを捨てる (アンテナハウス互換。HtmlImportOptions.inlineMarginStartAtWrapAh)
   */
  inlineMargin?: { start?: number; end?: number; bound?: boolean; dropStartAtWrap?: boolean };
  /** 行内の固定の長さ (pt。fo:inline の inline-progression-dimension)。内容がこれより短いときは、余りを空白 (背景色つき) で埋める */
  width?: number;
  /** リンク (fo:basic-link)。行ごとの領域が PDF のリンク注釈になる */
  link?: LinkTarget;
  /** PDF の注釈 (最初の行の領域に付ける) */
  annotation?: Annotation;
}

/**
 * 行番号。mode が show の段落の行に番号を振る (hide は数えるが出さない、none は数えない)。
 * 振り方 (format・initial・interval・start・reset) は page-sequence / flow の指定を使い、見た目は段落の指定を使う。
 */
export interface LineNumbering {
  mode?: 'show' | 'hide' | 'none';
  /** 番号の書式 (page-number の format と同じ。1・01・i など) */
  format?: string;
  /** 数え始め (reset のたびにこの番号から) */
  initial?: number;
  /** 何行おきに出すか */
  interval?: number;
  /** 最初に出す番号 (既定は数え始めの番号 initial。interval が 2 なら 1, 3, 5…) */
  start?: number;
  /** 数え直す単位 */
  reset?: 'page' | 'column' | 'none';
  /** 番号を置く側。alternate は段ごとに start と end を交互に */
  position?: 'start' | 'end' | 'alternate';
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'italic' | 'normal';
  color?: string;
  /** 段の端から番号までの間隔 (pt。既定 0) */
  offset?: number;
}

/** 改訂バー。段の端の外側 (offset だけ離して) に、行の高さの線を引く */
export interface RevisionBar {
  color: string;
  style?: BorderLineStyle;
  /** 線の太さ (pt) */
  width?: number;
  /** 段の端からの間隔 (pt)。changeBar のときは、段の端からバーの中心まで */
  offset?: number;
  /**
   * 引く側。start・end は段の行の始め・終わりの端。both は両側、alternate は段の番号で交互 (アンテナハウスの axf:revision-bar-position)。
   * changeBar のときは change-bar-placement (XSL 1.1 §7.30.4): left・right は段の左・右の端 (縦書きでは start・end として扱う)、
   * inside・outside は綴じる側とその反対 (横書き: 奇数ページの綴じる側は始めの端、偶数ページは終わりの端。縦書き: inside は始め、outside は終わり)、
   * alternate は 2 段のとき 1 段めの始めと 2 段めの終わり、ほかの段数では outside
   */
  position?: 'start' | 'end' | 'both' | 'alternate' | 'left' | 'right' | 'inside' | 'outside';
  /**
   * XSL 1.1 の変更バー (fo:change-bar-begin。§6.13.2・§6.4.5 の change bar area)。offset をバーの中心までの距離にし (§7.30.3)、
   * position を change-bar-placement として読む。隣り合うセルの行は、高い方の下まで 1 本にまとめる
   */
  changeBar?: boolean;
}

/** リンクの飛び先 (fo:basic-link)。internal は文書内の id、external は URI */
export interface LinkTarget {
  internal?: string;
  external?: string;
}

/** PDF の注釈 (アンテナハウスの axf:annotation-*)。位置は inline の領域の左上からのずれ (pt、y は下向き) */
export interface Annotation {
  kind: 'text' | 'free-text' | 'stamp' | 'file-attachment';
  contents?: string;
  title?: string;
  /** 注釈の色 (アイコン・枠) */
  color?: string;
  /** FreeText の文字色 */
  textColor?: string;
  fontSize?: number;
  /** 開いた状態で表示する (Text) */
  open?: boolean;
  /** アイコン名 (Text: Comment / Key / Note / Help など、Stamp: Approved / Draft など) */
  icon?: string;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  /**
   * 添付するファイル (FileAttachment。axf:annotation-file-attachment と axf:annotation-file-name)。src は文書から見たファイルの名前か data: の URI、
   * name は PDF の中のファイル名。ファイルの中身は AssetStore.getFile で引く (無ければテキスト注釈にする)
   */
  file?: { src: string; name?: string };
  /**
   * 注釈のフラグ (PDF の注釈の辞書の F。ISO 32000-2 §12.5.3 Table 167 のビット)。アンテナハウスの axf:annotation-flags から。
   * 無ければ 0 (フラグ無し。axf:annotation-flags の初期値は空文字列)
   */
  flags?: number;
}

export interface LRuby extends BaseNode {
  type: 'ruby';
  baseText: string;
  rubyText: string;
  /** 2 段目のルビ (HTML の rtc。Ruby 1 の ruby-position: alternate で、親文字の下側 (縦書きは左) に置く) */
  rubyTextUnder?: string;
  /** ルビの字の色 (HTML の rt の color)。無ければ親文字と同じ字の色 */
  rubyColor?: string;
  /** 2 段目のルビの字の色 (HTML の rtc の color) */
  rubyColorUnder?: string;
  /**
   * ルビを置く側 (CSS Ruby 1 §4.1 の ruby-position)。'under' は、rubyText を親文字の下側 (縦書きは左)、rubyTextUnder (2 段目) を
   * 上側 (縦書きは右) に置く。無ければ、rubyText が上側 (縦書きは右)、rubyTextUnder が下側。
   * 側は、行の並ぶ向きで持つ: 無ければ rubyText が前の側、'under' は後ろの側。vertical-lr (行が左から右へ並ぶ) では、前の側が左、
   * 後ろの側が右なので、HTML の取り込みは、CSS の over (行の上側 = 右。CSS Writing Modes 3 §6.4) を 'under' に、under を指定なしにして渡す
   */
  rubyPosition?: 'under';
  /**
   * 2 段目 (rubyTextUnder)・親文字の字の配り方 (CSS Ruby 1 §4.3 の ruby-align)。注釈 (rubyText) の配り方は rubyAlign (TextStyle)。
   * 無ければ、まわりから継承した rubyAlign
   */
  rubyAlignUnder?: RubyAlign;
  rubyAlignBase?: RubyAlign;
  /**
   * タグ付き PDF: 親文字 (base) とルビ (text。2 段目も) の、中身の無い入力の節。組版は、その通し番号 (sourceRef) を、親文字の字とルビの字に
   * 付ける (読み込みが、それぞれに RB・RT の構造の節か、圏点なら飾りの番号を付ける。structureBuilder.ts の ruby)
   */
  tagParts?: { base: LInline; text: LInline };
}

/**
 * 割注の指定 (LInline.warichu)。open・close は、割注の前後の括弧 (JLREQ §3.4.2 の割注始め括弧類 cl-28・割注終わり括弧類 cl-29)。
 * 空の文字列なら付けない。括弧は割注の字の 2 倍の大きさで組む
 */
export interface LWarichu {
  open: string;
  close: string;
  /**
   * タグ付き PDF: 前後の括弧の、中身の無い入力の節 (WP の構造の節の番号が付く。ISO 32000-1 §14.8.4.4 の Table 338)。
   * 割注の inline そのものは、中身 (WT) の構造の節の番号を持つ (structureBuilder.ts の warichuParts)
   */
  tagParts?: { open?: LInline; close?: LInline };
}

/**
 * CSS Ruby 1 §4.3 の ruby-align の値。start: 箱の始めの端にそろえる。center: 中央。space-between: 字の間を均等に空けて両端をそろえる。
 * space-around: 字の間のアキの半分を両端にも付ける。字の間を空けるのは、和文の字 (漢字・仮名) どうしの間だけで、
 * 欧文の字の間は空けない (空ける所が無ければ中央にそろえる)
 */
export type RubyAlign = 'start' | 'center' | 'space-between' | 'space-around';

/**
 * fo:page-number-citation 相当。refId の要素 (id を持つブロック・表) が置かれたページ番号に置き換わる (目次用)。
 * ページ番号は組版してみないと分からないため、組版を最大 4 回繰り返して収束させる。
 */
/** page-number-citation の参照先のうち、文書の総ページ数を返すもの (CSS の本文の中の counter(pages)) */
export const TOTAL_PAGES_ID = '\u0000kumiori-total-pages';

export interface LPageNumberCitation extends BaseNode {
  type: 'page-number-citation';
  refId: string;
  /** 参照先が置かれた最後のページ (fo:page-number-citation-last)。既定は最初のページ */
  last?: boolean;
  /** 番号の書式 (page-number の format と同じ)。省略時は参照先のページの書式。CSS の counter(page, …) は、その計数の書式 */
  format?: string;
  /**
   * 物理的なページ番号 (文書の最初のページを 1 とする通し番号。initial-page-number によらない) を使う。
   * アンテナハウスの拡張 (FO の axf:physical-page-number="true"、CSS の counter(page physical))
   */
  physical?: boolean;
}

/**
 * 索引のページ番号の並び (fo:index-page-citation-list 相当。XSL 1.1 §6.10.7)。references の鍵の付いた所 (LDocument.indexEntries) の
 * 置かれたページを集め、重複を除き、続いたページを範囲にまとめて、ページ番号の並びの字に置き換わる。
 * ページは組版してみないと分からないので、ページ番号の参照 (LPageNumberCitation) と同じく、収束するまで組み直す
 */
export interface LIndexPageCitationList {
  type: 'index-page-citation-list';
  /** 引く鍵 (fo:index-key-reference)。文書の中の順 */
  references: LIndexKeyReference[];
  /** ページ番号 (と範囲) の間の区切り (fo:index-page-citation-list-separator)。省略は「, 」(カンマと空白) */
  listSeparator?: LInlineLevel[];
  /** 範囲の最初と最後のページ番号の間の区切り (fo:index-page-citation-range-separator)。省略は U+2013 (EN DASH) */
  rangeSeparator?: LInlineLevel[];
  /** 続いた 3 つ以上のページを範囲にまとめる (merge-sequential-page-numbers。§7.24.5)。既定 true */
  mergeSequential?: boolean;
  /** 別の references から来た続きのページも、1 つの範囲にまとめる (merge-ranges-across-index-key-references。§7.24.4)。既定 true */
  mergeRangesAcrossReferences?: boolean;
  /** 別の references が同じページを引いたとき、1 つだけ残す (merge-pages-across-index-key-references。§7.24.6)。既定 true */
  mergePagesAcrossReferences?: boolean;
}

/** 索引の鍵を引く 1 つ (fo:index-key-reference 相当。XSL 1.1 §6.10.6)。引いたページ番号の字の書式も持つ */
export interface LIndexKeyReference {
  /** 引く鍵 (ref-index-key。§7.24.7) */
  refKey: string;
  /** ページ番号を、引いた所へのリンクにする (page-number-treatment="link"。§7.24.3) */
  link?: boolean;
  /** ページ番号と前後の字の書式 (fo:index-key-reference に書いた、継承される性質) */
  style?: TextStyle;
  /** ページ番号の前・後ろに付ける字 (fo:index-page-number-prefix・fo:index-page-number-suffix。§6.10.2・§6.10.3) */
  prefix?: LInlineLevel[];
  suffix?: LInlineLevel[];
  /**
   * 引いたページを作った page-sequence の、ページ番号の前後の字 (fo:folio-prefix・fo:folio-suffix。§6.6.10)。
   * LPageSequence.folioKey → 前後の字
   */
  folios?: Record<number, { prefix?: LInlineLevel[]; suffix?: LInlineLevel[] }>;
}

/**
 * fo:external-graphic 相当のインライン画像。サイズ未指定なら画像の自然な大きさ (96dpi の px を pt に換算)。
 * 横書きでは下端を基線に揃え、縦書きでは字面の中央に置く。画像データは AssetStore に登録しておく
 * (無ければ、指定サイズ (既定 60×40pt) の灰色のプレースホルダで出力する)。
 */
export interface LImage extends BaseNode {
  /**
   * false: この箱 (行の中の、分けられない箱) そのものには、飾りの線 (下線・上線・取り消し線) を引かない
   * (CSS Text Decoration 3 §2: 画像やインラインブロックのような分けられないインラインの箱には、飾りの線を引かない)。HTML の読み込みが付ける。
   * 既定は、まわりの字と同じ線を箱にも引く (XSL-FO。XSL 1.1 §7.17.4)
   */
  decorateBox?: false;
  /**
   * 行の中での揃え: after-edge は画像の下端を字面の下端に、before-edge は上端を字面の上端に揃える
   * (アンテナハウスの -ah-alignment-baseline: text-after-edge など。字面はその行の最初に使える書体の上下。既定は下端を基線に)
   */
  /** line-bottom・line-top: 行の箱の下端・上端に揃える (CSS の vertical-align: bottom・top。CSS 2.1 §10.8.1) */
  alignmentBaseline?: 'after-edge' | 'before-edge' | 'central' | 'line-bottom' | 'line-top';
  /** 表のセルの最小の幅を測るとき、前後で改行しない (HTML の互換モードの、幅が auto のセルの中の img。Quirks Mode Standard §3.8) */
  noWrapInCellMin?: boolean;
  type: 'image';
  /** AssetStore のキー (相対パス・ファイル名・data URI)。`url('...')` の包みは取り除いておく */
  src: string;
  /** 角丸 (CSS の border-radius): 画像を角丸で切り抜く (CSS Backgrounds 3 §4.3)。百分率は画像の箱の大きさに対して */
  borderRadius?: BorderRadius;
  /**
   * 画像の罫線・内側の余白 (border・padding。BaseNode) のある画像の、罫線の箱の角丸 (外側の半径)。borderRadius は、その内側で画像を
   * 切り抜く半径 (外側の半径 − 罫線と余白。CSS Backgrounds 3 §4.2)
   */
  boxRadius?: BorderRadius;
  width?: number;
  height?: number;
  /**
   * 幅は、百分率の指定 (width: 100% など) を、読み込みのときの包含ブロックの幅の見積もりで長さにしたもの (percentSize で組むときに解き直さない
   * 置換要素: 行内の svg など)。grid の項目の min-content を測るときは、縮められる置換要素の百分率の幅として 0 にする (CSS Sizing 3 §5.2.2)
   */
  estimatedWidth?: boolean;
  /**
   * 包含ブロックの幅に対する百分率で指定した幅と、その上限・下限 (HTML の CSS の width・max-width・min-width。長さで書いたものも pct 0 で入れる。
   * どれかが百分率のときだけ)。width・height は、読み込みのときの見積もりの幅で決めた大きさで、組版エンジンは、行を組むときの
   * 包含ブロックの内容の幅で、幅を解き直して、上限・下限 (高さの上限・下限 minHeight・maxHeight (pt) も) を縦横比を保って当てる
   * (CSS 2.1 §10.2・§10.3.2・§10.4)。height は、長さで指定した高さ (pt。無ければ auto: 幅と本来の縦横比から決める)。中身の幅を測る組版で、基準が測る幅に
   * よるときは、min-content を測るときは百分率の部分を 0 として、max-content を測るときは auto (上限は none) として解く (CSS Sizing 3 §5.2.1)。
   * 横書きの行の中の画像だけ
   */
  percentSize?: {
    width?: PercentLength;
    maxWidth?: PercentLength;
    minWidth?: PercentLength;
    minHeight?: number;
    maxHeight?: number;
    height?: number;
    /**
     * maxWidth は既定のスタイルのもの (Kumiori の既定の img { max-width: 100% })、width・height は HTML の属性か auto: 幅・高さ
     * (無い向きは縦横比から) を望む大きさとして、上限・下限を縦横比を保って当てる (CSS 2.1 §10.4 の表。属性の大きさの画像を、
     * ページの幅に収めるために縮めても、歪めない)
     */
    uaFit?: boolean;
    /** uaFit のときの、属性の高さ / 幅 (width を項目の幅に置き換えても、この比で高さを決める) */
    fitRatio?: number;
  };
  /** 画像本来の大きさに対する倍率 (fo の content-width / content-height の百分率)。width / height があればそちらを優先 */
  widthScale?: number;
  heightScale?: number;
  /**
   * 画像に書かれた解像度 (PNG の pHYs・JPEG の JFIF) があれば、それで本来の大きさを決める (CSS の image-resolution: from-image)。
   * 書かれていなければ widthScale / heightScale
   */
  resolutionFromImage?: boolean;
  /**
   * 画像本来の大きさを、画像に書かれた解像度 (PNG・JPEG・BMP。無ければ 96dpi) で決める。widthScale / heightScale
   * (XSL-FO の content-width の百分率など) は、その大きさに掛ける
   */
  intrinsicFromImage?: boolean;
  /**
   * HTML の img・object の width・height の属性の縦横比 (高さ / 幅)。属性は aspect-ratio: auto w / h の指定にもなる (HTML §15.4.3) ので、
   * 作成者が auto を書いて属性の大きさを使わない向きも、画像本来の比が無いとき (読めない画像・大きさも viewBox も無い SVG) は、この比で決める
   */
  attrRatio?: number;
  /** uniform (既定): width × height に収まるよう縦横比を保って縮尺 / non-uniform: 指定寸法へ引き伸ばす */
  scaling?: 'uniform' | 'non-uniform';
  /**
   * width × height の枠への画像の収め方 (CSS の object-fit。CSS Images 3 §4.5)。cover: 枠を覆うように拡大して、はみ出しを切り抜く /
   * contain: 枠に収まる大きさで置く / fill: 枠へ引き伸ばす / none: 画像本来の大きさのまま置いて、はみ出しを切り抜く /
   * scale-down: none と contain のうち、小さくなるほう。指定すると scaling より優先
   */
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  /** 枠の中での画像の位置 (CSS の object-position。CSS Images 3 §4.6)。無ければ中央 (50% 50%)。fit が fill のときは使わない */
  fitPosition?: ObjectPosition;
  /**
   * 枠に合わせる倍率の制限 (fo の content-width / content-height の scale-down-to-fit・scale-up-to-fit)。down: 1 倍を超えない
   * (本来の大きさが枠以下なら本来の大きさ) / up: 1 倍を下回らない (本来の大きさが枠以上なら本来の大きさ)
   */
  fitLimit?: { w?: 'down' | 'up'; h?: 'down' | 'up' };
  alt?: string;
  /**
   * 画像を置く枠 (fo の width / height。画像の大きさ content-width / content-height と別に指定されたとき)。
   * 枠の中で、align (text-align) と blockAlign (display-align) で揃える
   */
  viewport?: { width?: number; height?: number; align?: 'start' | 'center' | 'end'; blockAlign?: 'start' | 'center' | 'end' };
  /** 画像 (枠があれば枠) の外側の罫線・余白・背景色 (fo:external-graphic の border / padding / background-color) */
  border?: BorderInput;
  padding?: EdgesInput;
  backgroundColor?: string;
  /**
   * 行の中の画像の外側の余白 (CSS の margin。上下左右の向き)。画像 (罫線・余白があればその外) のまわりを空け、行の中の送りと行の高さに入れる
   * (置換要素の行内の箱の高さは margin の箱の高さ。CSS 2.1 §10.8)。基線に揃える画像は、下の余白の外側の端を基線に置く (同 §10.8.1)。
   * ブロックとして置く画像では使わない (包むブロックの margin を使う)
   */
  margin?: EdgesInput;
}

/**
 * fo:inline-container 相当。行内に置く箱で、中に block を持てる (縦中横風の組み、行内の小さな表や囲み等)。
 * inline-progression-dimension (横書きは width、縦書きは height) 未指定なら、内容に合わせた幅 (行幅が上限) にする。
 * 横書きでは「最初の行の基線」を周囲の文字の基線に揃える。writing-mode が親と違っても組める。
 */
/** PDF のフォームの欄 (アンテナハウスの axf:form-field)。行内の箱 (LInlineContainer.formField) の中に置く */
export interface FormField {
  kind: 'text' | 'checkbox' | 'radio' | 'listbox' | 'combobox' | 'button';
  /** 欄の名前。radio は同じ名前のものが 1 つの組になる */
  name: string;
  description?: string;
  /** text: 初期値 / checkbox・radio: 選んだときの値 */
  value?: string;
  checked?: boolean;
  password?: boolean;
  multiline?: boolean;
  maxLength?: number;
  required?: boolean;
  readOnly?: boolean;
  /** listbox・combobox の選択肢 */
  options?: Array<{ value: string; label: string; selected?: boolean }>;
  /** checkbox・radio のチェックの形 (axf:field-checked-style。既定 checkmark) */
  checkStyle?: 'checkmark' | 'circle' | 'square' | 'cross' | 'star';
  multiple?: boolean;
  editable?: boolean;
  /** button の表示 */
  caption?: string;
  /** button の動作。submit は submitUrl へ送る */
  action?: 'submit' | 'reset';
  submitUrl?: string;
  submitMethod?: 'get' | 'post';
  /** 欄の文字の大きさ。auto は PDF の自動の大きさ (DA の Tf の大きさ 0。ISO 32000-2 §12.7.4.3) */
  fontSize?: number | 'auto';
  color?: string;
}

export interface LInlineContainer extends BaseNode, BoxStyle {
  type: 'inline-container';
  /** 絶対配置の箱 (LBlockContainer.inlineCb が同じ番号のもの) の基準になる行内の箱の番号 (LInline.cbKey と同じ) */
  cbKey?: number;
  /** 回転 (反時計回り)。回した後の外接矩形が行内の箱の寸法になる (下端を基線に揃える) */
  rotation?: Rotation;
  /** この箱を PDF のフォームの欄にする (中身は空にして、画面には欄の見本を描く) */
  formField?: FormField;
  /** 固定の高さ (幅) の中での内容の配置 (display-align)。既定 start */
  blockAlign?: 'start' | 'center' | 'end';
  /** 行の中での揃え。既定 baseline (中の最初の行の基線を行の基線に)。central は字面の中央、before-edge / after-edge は字面の上端 / 下端 */
  alignmentBaseline?: 'baseline' | 'central' | 'before-edge' | 'after-edge';
  /**
   * CSS の vertical-align: top・bottom の箱 (行の中では、字面の上端・下端に揃える: alignmentBaseline の before-edge・after-edge)。
   * 自分の部分木を作るので、囲む top・bottom の行内の要素の部分木に入れない (CSS 2.1 §10.8.1 の aligned subtree)。HTML の読み込みが付ける
   */
  ownLineAlign?: true;
  /** baseline で揃えるときの、箱の基線。既定 first (中の最初の行)。last は最後の行 (CSS の inline-block。切り抜く箱・行の無い箱は下端) */
  baselineFrom?: 'first' | 'last';
  /**
   * false: この箱 (行の中の、分けられない箱) そのものには、飾りの線 (下線・上線・取り消し線) を引かない
   * (CSS Text Decoration 3 §2: 画像やインラインブロックのような分けられないインラインの箱には、飾りの線を引かない)。HTML の読み込みが付ける。
   * 既定は、まわりの字と同じ線を箱にも引く (XSL-FO。XSL 1.1 §7.17.4)
   */
  decorateBox?: false;
  children: Array<LBlockLevel | LInlineLevel>;
}

/**
 * fo:float 相当。通常フローから取り出して、本文領域の端 (start/end) またはページ先頭 (before) に置く。
 *  - start / end : inline-start / inline-end 側へ寄せ、続く本文を回り込ませる (横書き=左/右、縦書き=上/下)。
 *                  回り込みの幅は行ごとに変わり、行分割はその幅で行う。幅は width (縦書きは height) で指定 (既定 1/3)。
 *  - before      : ページの block-start 側 (横書き=上、縦書き=右) へ。すでに置かれた本文は押し下げる。
 * 現ページに入らなければ次ページの先頭へ送り、本文は止めずに先へ進む。
 * 位置は「いまの挿入点」(インライン内ならそのブロックの先頭行) を基準とし、本文領域 (入れ子ブロックではなくページ) の端に寄せる。
 * margin は本文との間隔として占有領域に含まれる。
 */
export interface LFloat extends BaseNode, BoxStyle {
  type: 'float';
  /** 高さの決まった float の中での、内容の block 方向の配置 (アンテナハウスの -ah-display-align。XSL 1.1 §7.14.4)。既定 start */
  blockAlign?: 'start' | 'center' | 'end';
  /**
   * inside / outside は綴じ側 / 小口側 (奇数ページは start / end、偶数ページは逆)。
   * after: 段 (段組でなければページ) の block-end 側 (横書き=下) に、脚注の上に積む (アンテナハウスの float: bottom)。
   * center: 段の inline 方向の中央に置き、その高さの範囲には本文を置かない (本文は下へ続く)。
   * alternate: 最初の段では end、ほかの段では start (段の間に寄せる。アンテナハウスの float: alternate)
   */
  float: 'start' | 'end' | 'before' | 'after' | 'center' | 'alternate' | 'inside' | 'outside';
  /**
   * 段落の最初の字を大きくして数行に沈める指定 (CSS の initial-letter。CSS Inline 3 §7.3)。float: 'start' と一緒に使い、子は、字を入れた
   * ブロック 1 つ。size は字の大きさ (行の数)、sink は沈める行の数 (1 なら沈めず、上へ突き出す)。align は、まわりの文字のどこに
   * 合わせるか (initial-letter-align。§7.4): alphabetic = 大文字の高さと欧文の基線、ideographic = 字の枠の上端と下端、
   * leading = 行の上端と下端。字の大きさ・位置は、組むときに書体の値から決める (§7.5.3・§7.6.1)。字を入れたブロックの
   * 字の大きさ・行の高さの指定は使わない (§7.5.1)
   */
  initialLetter?: {
    size: number;
    sink: number;
    align?: 'alphabetic' | 'ideographic' | 'leading';
    /**
     * 以下は、XSL-FO の axf:initial-letters (アンテナハウスの拡張のドロップキャップ) の指定。HTML の initial-letter は使わない。
     * length: 字の大きさを長さで指定したもの (pt)。字の大きさはこの値で、size は使わず、字の大文字の高さが届く行の数を、組むときに
     * 書体の値から求める。sink が 0 なら、その行の数の小数を切り捨てた数
     */
    length?: number;
    /** 最初の行の側を、大文字の高さでなく x-height に合わせる (axf:initial-letters-first-line-head-height。和文・縦書きでは使わない) */
    xHeight?: boolean;
    /**
     * 字の箱の行の進む向きの後ろの空き。値は行ごとで、最後の値はその後の行にも当てる (axf:initial-letters-end-indent)。
     * pt + dcem × 字の大きさ (dcem はドロップキャップの字の大きさの単位)
     */
    endIndent?: Array<{ pt: number; dcem: number }>;
    /** 字の箱を、行の進む向きにずらす量 (字を置いたブロックの text-indent。pt + dcem × 字の大きさ)。最初の行の字下げには使わない */
    shift?: { pt: number; dcem: number };
    /** 字の箱の行の後ろの、さらに字下げする行の数 (adjacent はブロックの終わりまで: Infinity) */
    adjacent?: number;
    /** 字の前の約物 (axf:initial-letters-leading-punctuation-position="hang")。その幅だけ、字の箱を行の頭の外へ出す */
    hangLead?: string;
    /**
     * 字の箱の幅 (行の向きの大きさ) を、字の大きさの単位 dcem を含む長さで書いたもの (axf:initial-letters-width)。pt + dcem × 字の大きさ。
     * 組むときに、float の幅 (縦書きは高さ) にする。dcem を含まない幅は、float の幅のまま渡す
     */
    width?: { pt: number; dcem: number };
  };
  /**
   * 本文に食い込まない、余白に置く注 (傍注)。float の幅は本文領域の幅になり、中身は負の margin で余白へはみ出して置く。
   * 本文の行は短くならない。続けて置く傍注は、前の傍注の下へ積む
   */
  marginal?: boolean;
  /**
   * 置いた位置 (アンカー) を中身として扱い、前後の余白の相殺を止める (XSL-FO の fo:float は行内にアンカーを作る)。
   * 回り込みだけを含むブロックも空にならず、その space-before と space-after は相殺されない。
   * 既定 (CSS) では、回り込みは余白の相殺に関わらない
   */
  anchorIsContent?: boolean;
  /**
   * CSS の float の置き方 (CSS 2.1 §9.5.1・§10.3.5): 包含ブロック (いまの箱の内容の端) を基準に置き、同じ側の先の float の横に
   * 入れば並べる (入らなければ下へずらす)。幅の指定が無ければ shrink-to-fit。省略時は XSL-FO の置き方 (本文領域の端に積む)
   */
  cssPlacement?: boolean;
  /**
   * 行の中に書いた float の、書いた所の目印の番号 (LInline.floatAnchor が同じ番号の、中身の無い inline)。読み込みが、行内の要素の
   * 中の float を行内の要素の外 (包むブロックの並び) へ出したときに付ける。組版は、目印のある行を組むときに置く (cssPlacement のときだけ)
   */
  inlineAnchor?: number;
  /** CSS の clear (cssPlacement のとき): その側の先の float の下に置く (CSS 2.1 §9.5.2) */
  clear?: 'start' | 'end' | 'both';
  /** CSS の min-width・max-width (pt。内容の幅。cssPlacement で幅の指定が無いとき、shrink-to-fit の幅を抑える。下限が勝つ) */
  minWidth?: number;
  maxWidth?: number;
  /**
   * 前方 float (float: 'before') の内容の末尾の余白 (space-after) を、前方 float の領域の終わり (区切りの内容・本文の上) でも残す
   * (アンテナハウス互換)。省略時は XSL 1.1 §4.3.1 のとおり、参照領域の終わりの conditional な余白として捨てる
   * (続く前方 float との間の余白は、どちらでも残す)
   */
  keepTrailingSpace?: boolean;
  children: Array<LBlockLevel | LInlineLevel>;
}

/**
 * fo:footnote 相当。本文中には参照記号 (小さな番号) が入り、children (fo:footnote-body) は
 * そのページの脚注領域 (本文領域の末尾) に置かれる。番号は自動連番 (PageSequence.footnotes で書式指定)。
 */
export interface LFootnote extends BaseNode {
  type: 'footnote';
  /** 自動連番の代わりに使うラベル (例: '※')。参照記号と脚注本体の両方に使う */
  label?: string;
  /** false なら、本体 (children) が自分でラベルを含むものとして、エンジンはラベルを前置しない (既定 true) */
  bodyLabel?: boolean;
  /** 本文中の参照記号の大きさ (本文の文字に対する比)。省略時は FootnoteOptions.referenceScale */
  referenceScale?: number;
  /** 本文中の参照記号の字の太さ。省略時は、置く所の字の太さ */
  referenceWeight?: number;
  /** 本文中の参照記号の行の高さ (pt)。省略時は、置く所の行の高さ */
  referenceLineHeight?: number;
  /** 参照記号の上げ下げ。none: 本文と同じ基線。省略時は上付き */
  referenceShift?: 'super' | 'sub' | 'none' | number;
  /** 本文中の参照記号の前後の和欧間のアキ (text-autospace)。false: 空けない。省略時は、置く所の書式 */
  referenceAutospace?: boolean;
  /** 本文中の参照記号の書体・太さ・斜体・色・飾り線 (XSL-FO の参照側の fo:inline の指定)。省略は置く所の書式 */
  referenceStyle?: Pick<BaseNode, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'color' | 'textDecoration'>;
  /**
   * この脚注の番号の書式 (CSS の、この要素に当たる ::footnote-call・::footnote-marker の content)。省略時は FootnoteOptions の値。
   * callPrefix・callSuffix は参照記号、markerPrefix・markerSuffix は本体の頭の番号の前後の文字、numberFormat は番号の書式 (FootnoteOptions.format と同じ書き方)
   */
  callPrefix?: string;
  callSuffix?: string;
  markerPrefix?: string;
  markerSuffix?: string;
  numberFormat?: string;
  /** この脚注の本文の頭の番号の置き方と、outside のときの空き (CSS の、この要素に当たる ::footnote-marker の list-style-position)。省略時は FootnoteOptions の値 */
  labelPosition?: FootnoteOptions['labelPosition'];
  labelGapEm?: number;
  /**
   * タグ付き PDF: 本文の参照の印 (call) と、本体の頭の番号 (label) の、中身の無い入力の節。組版は、その通し番号 (sourceRef) を、印の字と
   * 番号の字に付ける (読み込みが、それぞれに参照 (Reference) と記号 (Lbl) の構造の節の番号を付ける。structure.ts)
   */
  tagParts?: { call: LInline; label: LInline };
  children: Array<LBlockLevel | LInlineLevel>;
}

export interface FootnoteOptions {
  /** 既定 decimal。kanji は 10 まで、circled は 20 まで (超えたら数字) */
  numberFormat?: 'decimal' | 'circled' | 'kanji' | 'asterisk';
  /** 連番の開始値 (シーケンスごと、reset="page" ならページごと。既定 1) */
  startNumber?: number;
  /** 番号の書式 (page-number の format と同じ書式。1・i・Ⅰ・①・*1 など)。numberFormat より優先 */
  format?: string;
  /** page: ページごとに番号を振り直す (組み直して確定する)。既定は page-sequence の通し番号 */
  reset?: 'page';
  /** 前の page-sequence の最後の番号に続けて振る (CSS の footnote カウンターは文書全体で 1 つ)。startNumber より優先 */
  continueNumbering?: boolean;
  labelPrefix?: string;
  labelSuffix?: string;
  /**
   * 脚注本文の頭の番号の前後の文字 (CSS の ::footnote-marker の content)。省略時は labelPrefix・labelSuffix (参照の印と同じ)。
   * CSS では、参照の印 (::footnote-call) と本文の頭の印の書式は別 (GCPM 3 §2.5・§2.6)
   */
  markerPrefix?: string;
  markerSuffix?: string;
  /**
   * 脚注本文の番号の置き方。outside: 本文の行の始め側の外にぶら下げる・inside: 本文の前にそのまま置く (CSS の ::footnote-marker の list-style-position)。
   * 指定なし: 番号と本文の間に全角の空きを入れる (XSL-FO)
   */
  labelPosition?: 'inside' | 'outside';
  /** outside の番号の終わりと本文の始めの間 (脚注の字の大きさに対する比。既定 0) */
  labelGapEm?: number;
  /** 本文中の参照記号の大きさ (本文に対する比。既定 0.7) */
  referenceScale?: number;
  /** 脚注本文のスタイル (既定: 本文の 0.8 倍・左/上揃え) */
  style?: TextStyle;
  /** 区切り線。false で無し。length 既定は本文領域の 1/3 */
  separator?:
    | false
    | {
        length?: number;
        pattern?: 'rule' | 'dots';
        thickness?: number;
        color?: string;
        spaceBefore?: number;
        spaceAfter?: number;
        /** 線の代わりに置く内容 (xsl-footnote-separator)。脚注領域の幅いっぱいに組み、他の指定は無視する */
        content?: Array<LBlockLevel | LInlineLevel>;
      };
  /** 脚注どうしの間隔 pt (既定 2) */
  spacing?: number;
  /** 脚注の領域の行の始め側・終わり側の内側の空き pt (CSS の @footnote の padding-left・padding-right など) */
  inset?: { start?: number; end?: number };
  /**
   * 脚注の領域の高さの上限 pt (区切りの線と、その前後の空きを含む。CSS GCPM 3 §2.4.2 の @footnote の max-height)。
   * 超える脚注は、行で分けて (分けられなければ丸ごと) 次のページへ送る。ページに脚注しか無いときは上限を超えてよい
   */
  maxHeight?: number;
}

/**
 * fo:marker 相当。どこにでも置けて、自身は何も出力しない。
 * 次に内容が置かれるページに「そのページのマーカー」として記録され、静的コンテンツの LRetrieveMarker から取り出せる。
 */
export interface LMarker extends BaseNode {
  type: 'marker';
  /** marker-class-name */
  className: string;
  children: Array<LBlockLevel | LInlineLevel>;
  /** 番号 (LRetrieveMarker.variants の鍵)。XSL-FO の marker に付く */
  key?: number;
}

/**
 * fo:retrieve-marker 相当 (PageSequence.staticContent 内でのみ有効)。
 * 該当マーカーの children を、この位置へ展開する (インライン内容だけなら inline で包み、マーカー自身のスタイルを保つ)。
 */
export interface LRetrieveMarker {
  type: 'retrieve-marker';
  className: string;
  /**
   * first-starting-within-page (既定) / last-starting-within-page: このページで始まるマーカーの最初 / 最後
   * first-including-carryover / last-including-carryover: 上記に加え、無ければ前ページからの持ち越し (直近のマーカー)
   * last-ending-within-page: このページで終わる (親の最後の断片がこのページにある) マーカーの最後。無ければこのページの最後、それも無ければ持ち越し
   * first-except: このページで始まるマーカーがあれば空、無ければ持ち越し (CSS の string(…, first-except)。章の最初のページだけ柱を出さない)
   * start: ページの先頭の値。最初の内容と一緒に始まるマーカー、無ければ持ち越し (CSS の string(…, start))
   */
  position?: 'first-starting-within-page' | 'last-starting-within-page' | 'last-ending-within-page' | 'first-including-carryover' | 'last-including-carryover' | 'first-except' | 'start';
  /** 持ち越しを探す範囲。既定 page-sequence */
  boundary?: 'page' | 'page-sequence' | 'document';
  /** marker の番号 (LMarker.key) ごとの、この位置の文脈で読んだ中身。あれば LMarker.children の代わりに使う (XSL 1.1 §6.13.6) */
  variants?: Record<number, Array<LBlockLevel | LInlineLevel>>;
}

/**
 * fo:retrieve-table-marker 相当 (表の header・footer のセルの中でのみ有効。XSL 1.1 §6.13.7)。
 * その表の断片 (ページ・段ごとの表の箱) の中のマーカー (本体のセル・セルの中のブロック・LTableRow.bodyMarkers) の children を、この位置へ展開する。
 * header・footer は断片ごとに組み直すので、断片ごとに中身と高さが変わりうる
 */
export interface LRetrieveTableMarker {
  type: 'retrieve-table-marker';
  className: string;
  /**
   * retrieve-position-within-table (§7.25.6)。既定 first-starting。
   * first-starting: この断片で始まる親のマーカーの最初。無ければこの断片の最初のマーカー (前の断片から続く親のもの)、それも無ければ範囲の中の最後
   * first-including-carryover: この断片の最初のマーカー。無ければ範囲の中の最後
   * last-starting: 範囲の中で、始まった親のマーカーの最後。無ければ範囲の中の最後
   * last-ending: 範囲の中で、終わった親のマーカーの最後。無ければ範囲の中の最後
   */
  position?: 'first-starting' | 'first-including-carryover' | 'last-starting' | 'last-ending';
  /** retrieve-boundary-within-table (§7.25.2)。探す範囲。table (既定): この断片と前の断片すべて・table-fragment: この断片だけ・page: この断片と、同じページの前の断片 */
  boundary?: 'table' | 'table-fragment' | 'page';
  /** marker の番号 (LMarker.key) ごとの、この位置の文脈で読んだ中身。あれば LMarker.children の代わりに使う */
  variants?: Record<number, Array<LBlockLevel | LInlineLevel>>;
}

/**
 * fo:leader 相当。行内で「余白を埋める」伸縮要素 (目次の点線リーダー、罫線リーダー等)。
 * 行に含まれる leader は、その行の残り幅 (最大長まで) を等分して埋める。
 */
export interface LLeader extends BaseNode {
  type: 'leader';
  /** dots: 文字の繰り返し / rule: 罫線 / space: 空白だけ。既定 dots */
  pattern?: 'dots' | 'rule' | 'space';
  /** dots の繰り返し文字 (既定: 横書き '.'、縦書き '・') */
  patternText?: string;
  /** dots の配置ピッチ pt。行頭基準の倍数位置に置くので、複数行で点が縦に揃う (既定 max(字送り, 0.5em)) */
  patternWidth?: number;
  /** rule の太さ pt (既定 0.5) */
  ruleThickness?: number;
  /** rule の線種 (XSL-FO の rule-style。既定 solid) */
  ruleStyle?: BorderLineStyle;
  /** leader-length.minimum / optimum / maximum (pt)。既定 0 / 0 / 無限 */
  length?: { minimum?: number; optimum?: number; maximum?: number };
  /**
   * leader-length の百分率 (0〜1)。親の領域の内容の inline 方向の寸法に対する割合 (XSL §7.22.4)。組むときに決める。
   * length の同じ成分より優先する。中身の長さを測るとき (表の自動レイアウト) は決められないので、minimum を使う
   */
  lengthPct?: { minimum?: number; optimum?: number; maximum?: number };
  /**
   * 点・文字列の繰り返しの周期の始まりを合わせる格子の基準 (XSL 1.1 §7.22.1 の leader-alignment)。
   * reference-area: 参照領域 (本文の領域・段・表のセル) の内容の始めの端、page: ページの始めの端。
   * 指定が無ければ (none)、行の始めからピッチの倍数の位置に置く。右から左の行・回したコンテナの中では、指定が無いのと同じ
   */
  alignment?: 'reference-area' | 'page';
  /**
   * CSS の leader() (Content 3 §2.5)。繰り返す字を少なくとも 1 回は見せ、入らなければ前の内容の後で改行して次の行に置く。
   * 後ろの内容とは同じ行に置く
   */
  cssLeader?: boolean;
  /**
   * CSS の leader() の字を、リーダーの始めの端から並べる (アンテナハウス互換。既定は Content 3 §5.3 のとおり、行の終わりの端から)
   */
  cssLeaderFromStart?: boolean;
}

export interface LTateChuYoko extends BaseNode {
  type: 'tate-chu-yoko';
  text: string;
  /**
   * 縮めすぎになっても横倒しに戻さず、縮めて 1em に収める (CSS の text-combine-upright。Writing Modes 4 §9.1.3:
   * 合わせた送りが 1em に収まるよう、必要なら縮める)。無ければ、縮めすぎ (半分未満) のときは横倒しで組む
   */
  fit?: boolean;
}

export interface LBlockContainer extends BaseNode, BoxStyle {
  type: 'block-container';
  /**
   * 中身が収める高さを超えたら、字の大きさ・行の高さを詰めて収める (アンテナハウスの拡張の overflow="condense" と axf:overflow-condense)。
   * methods は試す順 (前のもので収まらなければ次)。収める高さは、内容の高さの指定 (height) か maxBlock (pt)、maxBlockPct (本文の領域の高さに
   * 対する割合。ページに流す本文の中だけ)。どれも無ければ、ページに流す本文の keep-together の容器は本文の領域の高さ、ほかは詰めない (警告に出す)。
   * minFontSize・minLineHeight は下限 (pt)。clip は、詰めても収まらないときに中身を切り抜く (最後に試す方法の下限の後ろの hidden・error-if-overflow)
   */
  condense?: { methods: Array<'font-size' | 'line-height'>; maxBlock?: number; maxBlockPct?: number; minFontSize?: number; minLineHeight?: number; clip?: boolean };
  /**
   * 縦並びの flex の折り返しの容器 (flex-direction: column と flex-wrap: wrap。Flexbox 1 §9.3): 子を上から積み、高さを超える所で次の列へ移す。
   * 列の幅はその列のいちばん広い子の幅、列の間は gap。reverse (wrap-reverse) なら列を右から並べる。stretch (align-content: normal・stretch) なら、
   * 余った幅を列に等しく分けて列を広げる (Flexbox 1 §9.4 の 15)
   */
  flexWrapColumns?: { gap: number; reverse?: boolean; stretch?: boolean; justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly' };
  /** 書字方向の裏返し (XSL-FO の bt-lr・lr-bt など。WritingFlip) */
  writingFlip?: WritingFlip;
  /** true: 通常フローから切り離し、PageArea 原点 (仕上がり左上) 基準で配置 */
  absolutePosition?: boolean;
  /**
   * absolutePosition の箱の top を、本文の中の「いまの参照領域」(段をまたぐブロックの切り替わりで分かれた領域。LPageSequence.spanAreas と
   * 段組の本文) の先頭から測る (XSL 1.1 §7.6.1: 基準は、最も近い祖先の参照領域)。top の値は本文の領域の先頭を基準にした値のままにし、
   * 組むときに、領域の先頭までの距離を足す。'fill' は、高さを領域の下端までの長さから決めた箱 (領域が短いぶん、高さも縮める)。
   * 横書きの本文でだけ効く
   */
  areaOffset?: 'top' | 'fill';
  /**
   * absolutePosition の基準を、ページではなく、いちばん近い祖先のブロックコンテナの内容の箱にする
   * (left・top・right・bottom はその箱の左上・右下からの距離)。横書きのコンテナの中だけで効く
   */
  positionInContainer?: boolean;
  /**
   * absolutePosition の基準を、行内の箱 (同じ番号の cbKey を持つ LInline・LInlineContainer) にする (CSS の position が static でない
   * 行内の要素。CSS 2.1 §10.1 の 4)。箱は、その行内の箱と同じ行の並びの中 (行内の箱の後ろ) に置く。基準の矩形は、行内の箱の最初の断片の
   * 左上と、最後の断片の右下 (padding の箱)。left・top・right・bottom は、その矩形からの距離 (どれも無ければ、矩形の左上)
   */
  inlineCb?: number;
  /**
   * CSS の絶対配置の箱 (positionInContainer・inlineCb) の top・bottom・height のうち、百分率で指定したもの (0.5 = 50%)。
   * 基準は、包含ブロックの padding の箱の高さ (CSS 2.1 §10.1 の 4・§10.5、CSS Position 3 §3.1)。高さが中身で決まる箱も基準になるので、
   * 組版が、基準の箱を組み終えてから、top・bottom には足し (top・bottom に入っている長さは、百分率に足す分)、height には入れる。
   * pad は、組版が求める基準の箱の高さ (内容の箱) に足して、padding の箱の高さにする量 (pt)。
   * left・right は、百分率の left・right と margin-left・margin-right の割合の和 (基準は包含ブロックの padding の箱の幅。left・right に入っている長さに足す)。
   * padI は、組版が求める基準の箱の幅 (内容の箱) に足して、padding の箱の幅にする量 (pt。百分率の幅・margin・padding・left・right の基準)
   */
  cbPercent?: { top?: number; bottom?: number; height?: number; pad: number; left?: number; right?: number; padI?: number };
  /**
   * 基準がページの領域 (初期包含ブロック・固定配置の箱。CSS 2.1 §10.1 の 1・3) の箱の、位置の指定 (ページの領域の端からの距離。pt) と、
   * 百分率の top・bottom・height (0.5 = 50%。基準は領域の高さ) と left・right (基準は領域の幅)。left・top などには、読み込みのときに見積もったページの領域で、用紙の端からの
   * 位置に直した値が入っていて、組版エンジンは、箱を置くページの領域 (:first・:left・:right・名前付きのページで違う) で決め直し、百分率の
   * 幅・margin・padding (BoxStyle.percent) も、そのページの領域の幅で解く (CSS Paged Media 3 §3)
   */
  pageArea?: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
    pctLeft?: number;
    pctRight?: number;
    pctTop?: number;
    pctBottom?: number;
    pctHeight?: number;
    /**
     * top・bottom が両方 auto (staticTop)、left・right が両方 auto (staticLeft) の、position: absolute の箱: その向きの位置は static position
     * (CSS 2.1 §10.3.7・§10.6.4)。組版が、見つけた所 (ページの本文の流れの位置・行の中の位置) で決める。left は static position からの
     * ずれ (margin-left など)、top は 0 (組版が static position を決められないときに使う)
     */
    staticTop?: boolean;
    staticLeft?: boolean;
  };
  /**
   * 幅の指定が無く、left と right の片方しか無いとき、幅を中身に合わせて縮める (CSS の絶対配置の shrink-to-fit。CSS 2.1 §10.3.7):
   * min(max(最小の内容の幅, 使える幅), 内容の幅)。指定が無ければ、使える幅いっぱい (XSL-FO の absolute-position)
   */
  shrinkToFit?: boolean;
  /**
   * 親と書字方向が直交し、block 方向の寸法の指定が無いとき、親の内容の幅いっぱいに広げる (縦書きなら、行は右端から並ぶ)。
   * XSL-FO の見え方。指定が無ければ中身に合わせて縮む (CSS と同じ)
   */
  fillOrthogonal?: boolean;
  /** 絶対配置の重なり順。behind は本文の背面 (リージョンの背景色など)。既定は本文の前面 */
  layer?: 'behind' | 'front';
  /**
   * 回転 (反時計回り、reference-orientation)。width / height は回転前の寸法。top / left / right / bottom は回転後の外接矩形の辺。
   * 回転した箱 (90・270) で幅の指定が無いときは、本文領域の block 方向いっぱい (ページの高さ) を回転前の幅にする。
   */
  rotation?: Rotation;
  /**
   * 回転した箱 (90・270) をページに分けて組み、中身がページをまたぐとき、回転前の block 方向の長さ (回転後のページの横幅) を、
   * 中身の高さではなく本文の幅いっぱいにする。270° では中身が本文の右端から並ぶ
   * (ページをまたぐものは右寄せ、1 ページに収まるものは中身の大きさ)
   */
  rotatedFill?: boolean;
  /**
   * 固定の高さ (幅) の中での、内容の block 方向の配置 (display-align)。既定 start。space-between は子の間に余りを等分する
   * (CSS の align-content)。space-around は子の前後に半分ずつ、space-evenly は前後と間に同じ量 (縦並びの flex の justify-content)
   */
  blockAlign?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
  /** top も bottom も無い絶対配置の箱 (static position に置く) を、その位置から block 方向へずらす量 (pt。箱の margin-top) */
  staticOffset?: number;
  /**
   * 行内の要素の中で見つけた、ページを基準にする絶対配置の箱の、見つけた所の目印の番号 (LInline.staticAnchor が同じ番号の、中身の無い
   * inline。負の数)。読み込みが、箱を行内の要素の外へ出したときに付ける。組版は、目印のある行の目印の位置を static position にする
   */
  inlineAnchor?: number;
  keepWithNext?: boolean;
  keepWithPrevious?: boolean;
  breakBefore?: BreakKind;
  breakAfter?: BreakKind;
  /**
   * コンテナの中の段組 (アンテナハウスの axf:column-count)。高さの指定があれば段を順に埋め、無ければ段の高さを釣り合わせる。
   * rule は段間罫、ruleDisplay は gap (既定。内容のある段の間だけ) / all (空の段との間にも引く) / end (内容のある段それぞれの終わり側に引く)
   */
  columns?: {
    count: number;
    gap?: number;
    rule?: BorderSide;
    ruleDisplay?: 'gap' | 'all' | 'end';
    /** 段間罫の長さ (アンテナハウスの -ah-column-rule-length)。pct は段の高さに対する割合 (0〜1)、len は長さ (pt) */
    ruleLength?: { pct?: number; len?: number };
    /** 長さを縮めた段間罫の、段の中での位置 (-ah-column-rule-align。before: 上端、center: 中央 (既定)、after: 下端) */
    ruleAlign?: 'before' | 'center' | 'after';
    /**
     * 最後の子の下の余白を、段の高さに数えない (アンテナハウス互換。
     * 既定は数える: 段組の箱は新しいブロック整形文脈で、中の余白は箱の外へ畳まれない (CSS 2.1 §8.3.1))
     */
    discardEndMargin?: boolean;
    /**
     * アンテナハウス互換: 最初の段の頭の、最初の子の上の余白を捨てる (段の切れ目の後と同じ扱い)。
     * 仕様では、段組の箱は新しいブロック整形文脈で、最初の子の上の余白は残る
     */
    discardStartMargin?: boolean;
    /**
     * 段の数を column-width から決めた段組・段の間の百分率 (HTML の CSS)。count・gap は、読み込みのときの見積もりの幅で決めたもので、
     * 組版エンジンは、箱を置くときの実際の内容の幅で決め直す (CSS Multi-column 1 §3.4 の擬似アルゴリズム。width は column-width (pt)、
     * maxCount は column-count (auto なら無し)。gapPct は column-gap の百分率 (0.1 = 10%。基準は段組の箱の内容の幅。CSS Box Alignment 3 §8.1))
     */
    byWidth?: { width?: number; maxCount?: number; gapPct?: number };
  };
  /** pt。absolutePosition 時は PageArea 原点基準。right/bottom 指定時は width/height から逆算 */
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  children: Array<LBlockLevel | LInlineLevel>;
}

// ── Table ──

export interface LTableColumn {
  type: 'table-column';
  /** pt 固定 / 'auto' / 'N*' (比例) */
  width?: number | 'auto' | `${number}*`;
  /** 比例 ('N*') の列に足す固定の長さ (pt)。proportional-column-width(N)+長さ の式 (XSL §5.10.4) */
  widthExtra?: number;
  /** 列の罫線 (罫線を重ねる表 (collapse) でだけ使う。XSL §6.7.4) */
  border?: BorderInput;
  /**
   * 列の幅を、組むときに測ったセルの中身の幅 (max-content) にする (width は、測れないときの値)。
   * 中身の幅で決まる flex の項目の列に使う (Flexbox 1 §9.2 の 3 の E): 読み込みのときの見積もり (字の幅の足し算) は、行を組むときの
   * 字の間の空白・行内の箱の余白と枠・::before の中身・語間などを数えきれず、見積もりが狭いと最後の字が次の行に送られる (目次の項目名)。
   * ページ番号の引用 (target-counter(…, page)) の番号の桁の数も、組んでみるまで分からない。
   * 幅の変わった分は、同じ表の比例 ('N*') の列が受け、入りきらなければ flexItem の値で縮める
   */
  fitContent?: boolean;
  /**
   * flex の項目の列 (HTML の flex の 1 行の表)。中身に合わせる列 (fitContent) の幅を組むときに測ると、読み込みのときの見積もりと違うことがあるので、
   * 行の列の幅の合計が置く場所を超えたら、組版エンジンが項目を縮め直す (Flexbox 1 §9.7)。width は縮める前の幅 (仮の主軸の大きさ。外側の幅)。
   * 中身に合わせる列のある行の、項目の列にだけ付く
   */
  flexItem?: LFlexItemColumn;
  /**
   * flex の項目の列で、読み込みのときの容器の幅の見積もりで縮めた (か、縮めずに済んだ) もの (中身に合わせる列の無い行)。組むときの実際の
   * 置く場所 (表の内容の幅) に、列の幅の合計が入りきらなければ、組版エンジンが、この値で項目を縮める (Flexbox 1 §9.7。見積もりより狭い
   * 所 (grid の項目・表のセル・inline-block・絶対配置の箱の中など) に置いた flex の容器)。width は見積もりで決めた幅 (外側の幅)
   */
  flexLate?: LFlexItemColumn;
  /**
   * grid の 1 行の表 (LTable.gridTemplate) の、項目 (か、項目の無い残り) の列が占める grid の列の範囲 [from, to)。組版エンジンが、表を置くときの
   * 内容の幅で列の幅を決め (gridTracks)、この範囲の列の幅と、間の間隔を足した幅にする
   */
  gridSpan?: [number, number];
  /** grid の 1 行の表の、項目の間の間隔の列 (幅は LTable.gridTemplate の間隔を、表を置くときの内容の幅で解いたもの) */
  gridGap?: boolean;
}

/** flex の項目の列の、縮めるための値 (LTableColumn.flexItem。長さは pt) */
export interface LFlexItemColumn {
  /** flex-shrink */
  shrink: number;
  /** flex の基準の大きさ (内容の幅。縮める比の基準)。中身に合わせる列では、組むときに測った幅から edge を引いたもの (この値は使わない) */
  basis: number;
  /** 外側の幅のうち、内容の幅以外 (左右の余白・枠・内側の余白) */
  edge: number;
  /** 縮める下限 (外側の幅。min-width の指定か、見積もった中身の最も狭い幅) */
  floor: number;
  /**
   * min-width: auto (自動の最小の大きさ。Flexbox 1 §4.5): 下限を、組むときに測った中身の最も狭い幅 (min-content) にする。
   * minCap は、その上限 (幅の指定・max-width の外側の幅。無ければ上限無し)
   */
  minAuto?: boolean;
  minCap?: number;
  /**
   * 項目が画像そのもの (置換要素) のときの自動の最小の大きさ (Flexbox 1 §4.5): 組むときに測った画像の幅 (指定の幅か本来の幅。セルの max-content) を、
   * cap (指定の幅・長さの max-width の外側の幅) で抑えたもの。max-width が百分率なら、その比 (maxPct) と外側の幅に足す分 (maxEdge) で、
   * 組むときの容器の内容の幅で解いて抑える (項目の百分率の基準は flex の容器。中身の幅を測る組版では、基準を 0 とする: CSS Sizing 3 §5.2.2)。
   * floor は、読み込みのときの見積もり (容器の幅 W で解いた値。画像の本来の大きさが分からなければ 0)
   */
  replacedMin?: { cap?: number; maxPct?: number; maxEdge?: number };
  /** 上限 (外側の幅。max-width) */
  cap?: number;
  /**
   * 項目が画像そのもので、max-width が百分率 (既定のスタイルの 100% も) のとき: その比 (f) と、外側の幅に足す分 (edge)。cap は読み込みのときの
   * 見積もりの容器の幅で解いたものなので、組むときに、実際の容器の内容の幅で解いて、項目の幅が上限に当たっているか (既定の max-width が画像を
   * 縮めたか) を見る (CSS 2.1 §10.4。min-width・overflow で自動の最小の大きさを外した、replacedMin の無い項目も)
   */
  capPct?: { f: number; edge: number };
}

export interface LTableCell extends BaseNode, BoxStyle {
  type: 'table-cell';
  /**
   * 中の絶対配置の箱 (positionInContainer) の基準になる (CSS の position が static でないセル。CSS 2.1 §10.1)。
   * 中の箱は、行の高さが決まってから、セルの内容の箱の左上・右下からの距離で置く (LBlock.containingBlock と同じ)
   */
  containingBlock?: boolean;
  /**
   * CSS の position: relative のずらし (pt。右・下が正。CSS 2.1 §9.4.3)。表を組んだ後のセルの箱 (中身・背景・罫線) を動かし、行の高さ・列の幅・
   * ほかのセルの位置は変えない (HTML のリストの項目は、記号のセルと本文のセルの両方に付ける)
   */
  relativeOffset?: { x: number; y: number };
  /**
   * セルの高さの中での内容の block 方向の配置 (display-align)。既定 start。baseline は同じ行の baseline のセルの最初の行の基線をそろえる。
   * last-baseline は同じ行の last-baseline のセルの最後の行の基線をそろえ、行の下端に寄せる (CSS の flex の align-items: last baseline)
   */
  blockAlign?: 'start' | 'center' | 'end' | 'baseline' | 'last-baseline';
  colSpan?: number;
  /** 行方向の結合。結合された行は 1 つの塊として扱い、ページをまたがない */
  rowSpan?: number;
  /**
   * 末尾の内容の後ろの余白 (margin-bottom) を捨てずに、セルの高さに含める (HTML のリストの項目の本文。CSS では li の最後の子の
   * 余白は li の外へ抜けて、次の項目との間に残る)
   */
  keepTrailingSpace?: boolean;
  /**
   * 末尾の内容の後ろの余白 (margin-bottom) を、セルの高さに含めず、表の後ろの余白として表の外へ出す (値は、それと重ねる余白)。
   * HTML のリストの最後の項目の本文: li の最後の子の余白と li の余白は、リストの後ろの余白・次のブロックの余白と重なる (CSS 2.1 §8.3.1)
   */
  trailingSpaceOut?: number;
  /**
   * セルの先頭の内容の前の余白 (margin-top) と末尾の内容の後ろの余白 (margin-bottom) を捨てず、セルの高さに含める
   * (CSS の表のセルと flex の項目: セルは新しい整形文脈で、中の margin はセルの外と重ならない。XSL では参照領域の先頭・末尾の space を捨てる)
   */
  keepEdgeSpace?: boolean;
  /** 行の高さに余りがあれば、セルの中の唯一のブロックをその分だけ伸ばす (flex の align-items: stretch。項目の背景・枠が行の高さまで広がる) */
  stretchContent?: boolean;
  /** stretchContent で伸ばすブロックの高さの上限 (pt。枠・内側の余白を含む。flex の項目の max-height) */
  stretchMax?: number;
  /**
   * collapse の表で、改ページの境目の罫線を決め直すのに使う、このセルの前側・後ろ側の罫線 (セル・行・行グループの指定から選んだもの。
   * 隣のセルとはまだ比べていない)。組版が collapseTableBorders で付ける (src/tableBorders.ts の breakEdges)
   */
  breakEdges?: { before?: BorderSide; after?: BorderSide };
  children: Array<LBlockLevel | LInlineLevel>;
}
export interface LTableRow extends BaseNode {
  type: 'table-row';
  cells: LTableCell[];
  /**
   * HTML のリストの項目の行 (1 つ目のセルが外側の記号、2 つ目のセルが本文)。外側の記号は本文の最初の行の箱に置く (CSS Lists 3 §3.5:
   * ::marker は最初の行の行内の箱)。記号の行の、基線より下の部分が本文の最初の行より深ければ、最初の行より後ろの本文をその分だけ下げる
   */
  listMarkerRow?: boolean;
  /** 行をページの途中で分割しない (既定では、ページに入らない行はセルの中身を行単位で次ページへ分ける) */
  keepTogether?: boolean;
  /**
   * keepTogether の行が、新しいページ (段) にも入らない高さなら、分割しないことをやめ、いまの位置から行単位で分ける
   * (XSL-FO の仕様モードの keep-together と、アンテナハウス互換の数値の強さの keep-together、HTML の break-inside: avoid。省略時は、
   * 入らなくても分けずにはみ出させる: アンテナハウス互換の always と、アンテナハウス互換のスタイルの HTML の break-inside: avoid)
   */
  keepTogetherYields?: boolean;
  /** 行の高さの最小値 (pt。fo:table-row の height / block-progression-dimension、CSS の tr の height) */
  minHeight?: number;
  /** 行の高さの最大値 (pt。block-progression-dimension.maximum)。中身はそれを超えてもはみ出して描く */
  maxHeight?: number;
  /** 行の前後の余白 (pt。fo:list-item の space-before / space-after)。隣の行・表の前後の余白と重ね合わせる */
  spaceBefore?: number;
  spaceAfter?: number;
  /**
   * この行の前・後の強制の区切り。区切りの種類 (CSS の tr・li の break-before・break-after。CSS Fragmentation 3 §3.1: page はページ、
   * column は段、odd-page・even-page は白ページを挟んで奇数・偶数ページから。XSL-FO の fo:table-row・fo:list-item の break-before・
   * break-after (XSL 1.1 §7.20.1・§7.20.2) も同じ) か、true (種類を持たない区切り。次の段・ページへ送るだけ)
   */
  breakBefore?: boolean | BreakKind;
  breakAfter?: boolean | BreakKind;
  /** 次の行と同じページに置く */
  keepWithNext?: boolean;
  /** 前の行と同じページに置く */
  keepWithPrevious?: boolean;
  /** 行の罫線 (罫線を重ねる表 (collapse) でだけ使う。XSL §6.7.9) */
  border?: BorderInput;
  /** 行グループ (table-header・table-body・table-footer) の罫線と、この行がグループの最初・最後か (collapse でだけ使う) */
  group?: { border: BorderInput; first: boolean; last: boolean };
  /**
   * この行を含む fo:table-body の子の fo:marker (XSL 1.1 §6.7.8) と、この行がその本体の最初・最後の行か。
   * 同じ本体の行は、同じ markers の配列を持つ。LRetrieveTableMarker から取り出せる (本体の断片ごとの領域に付く)
   */
  bodyMarkers?: { markers: LMarker[]; first: boolean; last: boolean };
}
export interface LTableBody extends BaseNode {
  type: 'table-body';
  rows: LTableRow[];
}

/**
 * grid の項目の、列の下限への寄与 (LTable.gridTemplate.items)。col は項目の占める列 (1 列だけを占める項目)、cell は項目を入れた行の表のセル。
 * floor があれば、測らずにその値 (外側の幅。min-width の長さ・決まった width・overflow が visible でない項目: CSS Grid 1 §6.6)。
 * 無ければ、組版エンジンが、セルの中身の min-content を測る (cap は max-width の長さによる上限。外側の幅)
 */
export interface GridItemFloor {
  col: number;
  cell: LTableCell;
  floor?: number;
  cap?: number;
}

export interface LTable extends BaseNode, BoxStyle {
  /** HTML の flex の容器の 1 行の表 (htmlImport の flexNoRect)。中身の幅を測るとき、比例の列は足す固定の長さだけを数える (LNode.flexContentI) */
  flexLine?: boolean;
  /**
   * HTML の grid の容器の 1 行の表 (列は LTableColumn.gridSpan・gridGap)。列の幅は、組版エンジンが、表を置くときの内容の幅 (容器の実際の
   * 内容の幅) W で gridTracks(tracks, W, 間隔, 下限, repeat) を呼んで決める (CSS Grid 1 §11・§12。読み込みのときの幅の見積もりでなく)。
   * tracks は grid-template-columns の計算値 (相対の長さは px にしてある)。gap は列の間隔 (pt)、gapPct は百分率の間隔の比 (W に掛ける)。
   * 同じ grid の容器の行の表は、同じ値 (この物) を持つ。items は、その grid の全部の行の、1 列だけを占める項目 (GridItemFloor)。列挙しない性質
   * (sourceRef.ts の setGridItems。文書の木を性質を選ばずにたどる所が、行の表ごとに全部の項目をたどり直さないように。写すときは gridCopies)。組版エンジンは、
   * 項目の自動の最小の大きさ (CSS Grid 1 §6.6: 項目の中身を、組むときと同じ折り返しで測った min-content) の、列ごとの最大を、0fr の列の幅と、
   * 最小の大きさが auto の列 (fr・auto・minmax(auto, …)) の下限にする (§12.5・§12.7.1。grid 全体で 1 つ。どの行でも同じ列の幅)。
   * repeat は auto-fill・auto-fit の回数 (読み込みのときの幅の見積もりで決めた回数。行に並べた項目の数を変えないため)。
   * 中身の幅を測る組版では、長さの列はその幅、百分率の列は auto (中身の幅)、fr・auto・minmax() の列は項目の中身の幅から決める
   * (LNode.flexContentI。CSS Grid 1 §7.2.1・§12.7: max-content では、fr の 1 つ分を、項目の max-content を列の比で割ったものの最大にする。
   * min-content では、項目の min-content。どちらも minmax() の最小・最大の大きさの間)
   */
  gridTemplate?: { tracks: string; gap: number; gapPct?: number; items?: GridItemFloor[]; repeat?: number };
  /** HTML のリスト (ul・ol と display: list-item) を組む表 (記号の列と本文の列)。中身の幅を測るとき、本文の列は置く場所いっぱいでなく、本文の中身の幅を数える (LNode.listContentI) */
  listTable?: boolean;
  type: 'table';
  /**
   * セルの中の絶対配置の箱 (positionInContainer) の基準になる (CSS の position が static でない表。CSS 2.1 §10.1)。
   * 中の箱は、表を組み終えてから、表の内容の箱の左上・右下からの距離で置く (LBlock.containingBlock と同じ)
   */
  containingBlock?: boolean;
  /** 高さの決まった箱の子として、余った高さを分けてもらう比 (flex の折り返しの容器の align-content: stretch の行。LBlock.flexGrow と同じ) */
  flexGrow?: number;
  columns: LTableColumn[];
  /**
   * 表の幅が置く場所の幅より狭いとき、親から継承した text-align (center・end) で寄せる
   * (XSL-FO の table-and-caption の中の表。§6.7.2。CSS の表は text-align で寄せない)
   */
  alignByTextAlign?: boolean;
  /**
   * 余白が auto の向き (CSS 2.1 §10.3.3)。中身に合わせた幅 (fitContent) の表で、置く場所の残りを
   * 'center' は左右に等分、'end' は終わり側の余白、'start' は始まり側の余白に足す
   */
  autoMargins?: 'start' | 'center' | 'end';
  /**
   * アンテナハウス互換 (collapse): 外枠の罫線の外へ出る半分を、block 方向・inline 方向とも始めの側の余白に重ねず、表全体を内側に
   * 置く (block 方向の終わりの側も重ねず、表の箱の中に数える)。
   * 仕様 (CSS 2.1 §17.6.2) では両側とも余白にはみ出す
   */
  collapseSpillAh?: boolean;
  /**
   * アンテナハウス互換 (separate): 行をまたぐセルの中身を中央 (display-align: center) に寄せるとき、またいだ行の間の
   * セルの間隔 (border-spacing の block 方向) を除いた高さで中央を出す (中身は、またいだ間隔の合計の半分だけ上に寄る)。
   * 仕様 (CSS 2.1 §17.5.3) では、セルの箱の中で中央に置く
   */
  rowspanMiddleAh?: boolean;
  /**
   * 上の見出し (caption) と表ヘッダーの行を、本体の最初の行 (rowSpan でつながる行の塊) と同じページに置く。入らず、
   * 改ページすれば入るなら、表の前で改ページする (アンテナハウス互換。見出しと表ヘッダーだけを
   * 前のページに残さず、表ごと次のページに置く)
   */
  keepHeaderWithBodyAh?: boolean;
  /**
   * 表の見出し (CSS の caption)。表の上 (top) か下 (bottom) に、表の罫線の外側の幅のブロックとして置く
   * (CSS 2.1 §17.4・CSS Tables 3 §3.5.3: 表と見出しを包む箱の幅は、表の罫線の外側の幅。表の余白はその箱が持つ)
   */
  captions?: Array<{ side: 'top' | 'bottom'; block: LBlock }>;
  /**
   * 罫線の重ね方。collapse: 隣り合うセルの罫線を 1 本にまとめる (太い方が勝つ。XSL-FO の初期値)。
   * separate (既定): セルごとに罫線を描く
   */
  borderCollapse?: 'collapse' | 'separate';
  /**
   * collapse の内側の罫線を、後ろ (右・下) のセルが全体の太さで持つ (前のセルは罫線の場所を取らない)。
   * 互換モードの組み方。省略時は仕様どおり、隣り合うセルが半分ずつ持つ (XSL §6.7.10・CSS2 §17.6.2)
   */
  collapseToAfterCell?: boolean;
  /**
   * 互換の組み方 (collapseToAfterCell) の、列の境目の線ごとの、いちばん太い線の太さ (組版が collapseTableBorders で付ける)。
   * 添え字 k は、列 k の始めの線 (k は 1 から列の数 − 1)。後ろのセルの箱は、グリッド線からこの半分だけ前で始まる
   */
  collapseColumnLines?: number[];
  /**
   * collapse の表で、改ページの境目の罫線を決め直すのに使う、列ごとの線 (組版が collapseTableBorders で付ける)。
   * headerAfter: 表ヘッダーの最後の行の後ろ側、footerBefore: 表フッターの最初の行の前側 (セル・行・行グループの指定から選んだもの)
   */
  breakBorders?: { headerAfter: Array<BorderSide | undefined>; footerBefore: Array<BorderSide | undefined> };
  /**
   * 罫線を分ける表 (separate) のセルの間隔 (pt)。i: 列の間 (inline 方向)、b: 行の間 (block 方向)。表の端とセルの間にも空ける
   * (XSL の border-separation §7.28.5・CSS の border-spacing)
   */
  borderSpacing?: { i: number; b: number };
  breakBefore?: BreakKind;
  breakAfter?: BreakKind;
  /** 表全体を 1 ページに収める (入らなければ表の前で改ページ。1 ページより大きい表は通常どおり分割) */
  keepTogether?: boolean;
  keepWithNext?: boolean;
  keepWithPrevious?: boolean;
  /** 改ページ時に各ページ先頭で繰り返す */
  header?: LTableBody;
  /** 表の末尾の行。改ページ時には各ページの末尾でも繰り返す (omitFooterAtBreak で表の末尾だけ) */
  footer?: LTableBody;
  /** fo の table-omit-header-at-break / table-omit-footer-at-break */
  omitHeaderAtBreak?: boolean;
  omitFooterAtBreak?: boolean;
  /** 幅の指定が無いとき、列の幅を中身の長さ (最も長い行) に合わせ、表の幅をその合計にする (数式の mtable など) */
  fitContent?: boolean;
  /** 列の幅の指定を、自動レイアウトの列の最小・最大の幅として使う (CSS 2.1 §17.5.2.2。HTML の表) */
  columnWidthsAsMinimum?: boolean;
  /**
   * 幅の指定がある自動レイアウトの表 (XSL の table-layout="auto"。§6.7.3 / CSS2 §17.5.2.2): 列の幅を中身の長さから決め、
   * 表の幅に足りなければ、残りを列の幅の比で配る。fitContent と同じく、列の幅の指定が無い表で使う
   */
  fillContent?: boolean;
  /**
   * fitContent の表が入りきらないときの列の幅の配り方。
   * 'interpolate' (既定): 各列の最小と最大の長さの間を同じ比で配る (CSS のブラウザと同じ)。
   * 'max-ratio': 最大の長さが均等割りの半分以下の列は最大の長さのまま。残りの列は、各列の最大の長さ (使える幅で頭打ち) の比で配る
   * (XSL-FO の表と、HTML の入力のアンテナハウス互換)
   */
  fitContentRule?: 'interpolate' | 'max-ratio';
  body: LTableBody;
}

// ───────────────────────── 物理ツリー (Area Tree - Output) ─────────────────────────

export type AreaType =
  | 'sheet'
  | 'page'
  | 'region-body'
  | 'block'
  | 'line'
  | 'inline'
  | 'glyph'
  | 'table'
  | 'table-row'
  | 'table-cell'
  | 'ruby'
  | 'tate-chu-yoko'
  | 'image';

export interface AreaBase {
  type: AreaType;
  x: number;
  y: number;
  width: number;
  height: number;
  margin: Edges;
  padding: Edges;
  border: BorderStyle;
  backgroundColor?: string;
  /** 背景画像 (大きさは解決済み。後ろに重ねる画像 under も、それぞれ大きさは解決済み) */
  backgroundImage?: BackgroundImage & { width: number; height: number };
  /** 背景の色を塗る範囲 (CSS の background-clip)。無ければ border の箱 (width × height) */
  backgroundClip?: 'padding-box' | 'content-box';
  writingMode: WritingMode;
  /**
   * 箱の回転 (反時計回り。reference-orientation)。width / height は回転前の局所サイズ、x / y は回転後の外接矩形の左上。
   * 子の座標は局所 (回転前) 座標系。90・270 のとき外接矩形の幅 = height、高さ = width。
   * (GlyphArea.rotation は「文字」の回転なので別物。名前を分けている)
   */
  orientation?: Rotation;
  /**
   * 描くときの変換 (CSS の transform)。[a, b, c, d, e, f] は x' = a·x + c·y + e、y' = b·x + d·y + f (y は下向き、pt)。
   * 座標の原点は、この Area の x・y の点 (border-box の左上。orientation があれば回転後の外接矩形の左上)。
   * この Area とその子孫を描くときだけに掛ける。x・y・width・height と子の座標は、変換の前のまま (組版は変換を知らない)
   */
  transform?: [number, number, number, number, number, number];
  /**
   * 不透明度 (CSS の opacity。0 以上 1 未満。1 のときは欄が無い)。この Area とその子孫をまとめて 1 枚の絵にしてから、この濃さで重ねる
   * (中の重なりは濃くならない)。transform と両方あれば、変換した絵を重ねる
   */
  opacity?: number;
  /** 内容を padding の外端で切り抜く (overflow="hidden" 等) */
  clip?: boolean;
  /**
   * 輪郭線 (CSS の outline。CSS UI 4 §3)。罫線の箱 (width × height) の外側に、offset だけ離して描く。この Area の中身と罫線より後 (上) に描く。
   * 角丸 (borderRadius) の箱では、輪郭線の角も丸くなる
   */
  outline?: Outline;
  /**
   * 切り抜きの矩形 (CSS の clip。CSS 2.1 §11.1.2)。x・y は、この Area の border-box の左上からの位置 (pt)。この Area の影・背景・罫線・
   * 輪郭線と子孫を、この矩形で切り抜いて描く (clip は padding の箱で子だけを切り抜く。こちらは箱そのものも切り抜く)。
   * 幅か高さが 0 以下なら、何も描かない
   */
  clipRect?: Rect;
  /** CSS の回り込み (float) の箱。親の流れの中のブロックの背景より手前、行内の中身より奥に描く (CSS 2.1 §9.5) */
  float?: boolean;
  /** デバッグ・トレース用 */
  sourceId?: string;
  /**
   * この Area を作った入力の節の通し番号 (documentNodes(doc) の位置。sourceRef.ts)。
   * 字は、それを含む inline (無ければ block) の番号
   */
  sourceRef?: number;
  borderRadius?: BorderRadius;
  /** 影。複数なら、先のものが上に描かれる (CSS と同じ) */
  boxShadow?: BoxShadow | BoxShadow[];
  /** 斜めの罫線 (対角罫・逆対角罫)。tlbr は左上から右下、trbl は右上から左下 (border-box の角どうし) */
  diagonals?: Array<{ kind: 'tlbr' | 'trbl'; side: BorderSide }>;
  /** この領域がリンク / 注釈の範囲 (描画はせず、PDF の注釈になる) */
  link?: LinkTarget;
  annotation?: Annotation;
  /** PDF のフォームの欄 (border の内側) */
  formField?: FormField;
}

/** 絶対配置を含みうるコンテナ */
export interface BlockLikeArea extends AreaBase {
  children: Area[];
}

/** 字 (同じ書体・大きさ・色の字の並び)。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface GlyphArea extends AreaBase {
  type: 'glyph';
  /** 字の並び */
  text: string;
  /** 書体のファミリー名 */
  fontFamily: string;
  /** 書体の太さ (100〜900) */
  fontWeight: number;
  /** 字の大きさ (pt) */
  fontSize: number;
  /** 字の色 (CSS の色の書き方) */
  color: string;
  /**
   * 描画原点 (ベースライン左端) の glyph area ローカル座標。
   * 縦書き upright / rotate / 補正オフセットを含めて解決済み。
   */
  baselineX: number;
  baselineY: number;
  /** 描画時に原点まわりに時計回りで回す角度 (deg)。縦書き横倒し字は 90 */
  rotation: 0 | 90;
  /** 疑似斜体 (描画時に傾斜させる) */
  italic?: boolean;
  /** 疑似太字 (太字を求めたが、書体に太字が無い。描画時に字の輪郭を太らせる) */
  fakeBold?: boolean;
  /**
   * 字形を差し替える OpenType の機能 (TextStyle.fontFeatures)。
   * '-init' は機能の名前でなく、組版が足す印: ベンガル文字の語の途中の字の単位で、語頭の形 (init) を当てない (fontkitShaping.ts の NOT_WORD_INITIAL)
   */
  features?: string[];
  /** 水平方向の拡縮 (縦中横の圧縮) */
  scaleX: number;
  /** 組版上の進行方向の送り幅 (pt。字間・詰めを含む) */
  advance: number;
  /** 描く書体 (AreaTree.resources.fonts の id)。fontFamily・fontWeight で選んだ書体 */
  fontId?: string;
  /**
   * 描く字形の番号 (書体の中の番号。text を書体の OpenType の機能 (features) で組んだ結果。左から右へ描く順)。
   * 書体のファイル (resources.fonts の sha256 で特定できる) があれば、字を字形に直さずに描ける
   */
  glyphIds?: number[];
  /**
   * 字形ごとの位置 [送り, 横のずらし, 縦のずらし] (書体の単位。resources.fonts の unitsPerEm で 1 em)。書体の GPOS で調整したもの。
   * 字形が 2 つ以上あり、送りが書体の送り幅と違うか、ずらしがあるときだけ付く (アラビア文字の記号の位置など)
   */
  glyphPositions?: Array<[number, number, number]>;
  /**
   * 色つきの字形のパレットの選び方 (CSS の font-palette と `@font-palette-values` の結果。colorGlyph.ts の FontPalette)。
   * 既定のパレット (font-palette: normal) のときは付かない。色つきの表 (COLR/CPAL) を持つ書体の字だけに効く
   */
  fontPalette?: { base?: number | 'light' | 'dark'; colors?: Array<[number, string]> };
  /**
   * 分綴で行末に足した字 (CSS Text 4 §6.3.2 の hyphenate-character・XSL 1.1 §7.10.5 の hyphenation-character。入力の字ではない)。
   * タグ付き PDF では、置き換えの文字列 (ActualText) をソフトハイフン (U+00AD) にして、読む字のハイフンにしない (ISO 32000-1 §14.8.2.5・§14.9.4)
   */
  hyphen?: boolean;
  /**
   * この字の後ろで行を分け、行末で捨てた空白の字 (行の最後の字にだけ付く。段落の終わりと強制改行の行には付かない)。
   * タグ付き PDF では、この字の後ろに、その空白を見えない字として書き、構造の順に読む字で、前の行の終わりの語と次の行の初めの語が
   * つながらないようにする (ISO 32000-1 §14.8.2.5: 語の区切りは空白の字で表す)
   */
  breakSpace?: string;
}

/** 行の中の箱 (枠・背景・変換の付いた行内の要素など)。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface InlineArea extends BlockLikeArea {
  type: 'inline';
}

/** 画像 (SVG・MathML の数式を含む)。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface ImageArea extends AreaBase {
  type: 'image';
  src: string;
  /** 画像データが無い (プレースホルダを描く) */
  missing: boolean;
  alt?: string;
  /** 画像を置いた所の言語 (xml:lang・language・lang。BCP 47 か ISO 639 の符号)。SVG の systemLanguage (SVG 2 §5.6.5) を、この言語で照らす */
  language?: string;
  /**
   * 枠への収め方 (LImage.fit の cover・contain・none・scale-down)。描く時に、画像本来の大きさ (naturalWidth × naturalHeight。pt) から
   * 大きさを決め (none は本来の大きさ、scale-down は none と contain の小さいほう)、枠の中に置いて切り抜く
   */
  fit?: 'cover' | 'contain' | 'none' | 'scale-down';
  naturalWidth?: number;
  naturalHeight?: number;
  /** 枠の中での画像の位置 (CSS の object-position)。無ければ中央 */
  fitPosition?: ObjectPosition;
  /** 枠へ引き伸ばす (XSL の scaling="non-uniform")。SVG は preserveAspectRatio を none として描く */
  stretch?: boolean;
  /** 描かない (CSS の visibility: hidden。場所は残す) */
  hidden?: boolean;
}

/** ルビ (親文字とルビの字)。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface RubyArea extends AreaBase {
  type: 'ruby';
  /** 親文字 glyph 群 (RubyArea ローカル座標) */
  base: GlyphArea[];
  /** ルビ glyph 群 */
  ruby: GlyphArea[];
  /** ルビが占める block 方向の厚さ (pt) */
  rubyExtent: number;
}

/** 縦中横 (縦書きの中に横に並べた字)。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface TateChuYokoArea extends AreaBase {
  type: 'tate-chu-yoko';
  /** 横組みで並べた各文字 (TateChuYokoArea ローカル座標) */
  glyphs: GlyphArea[];
  /** 全角 1 文字枠に収めるための水平圧縮率 (1 = 圧縮なし) */
  scale: number;
  /** 占有する全角枠数 */
  frames: number;
}

/** 行。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface LineArea extends BlockLikeArea {
  type: 'line';
  /** 行内の inline-progression 方向の使用長 */
  contentLength: number;
  /** 行にルビがあるか */
  hasRuby: boolean;
}

/** ブロック (段落・見出し・リストの項目・図の枠など)。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface BlockArea extends BlockLikeArea {
  type: 'block';
  /** ページをまたいだ場合の継続断片か */
  isContinuation: boolean;
  /** 後続ページに続くか */
  continuesOnNext: boolean;
}

/** 表のセル。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface TableCellArea extends BlockLikeArea {
  type: 'table-cell';
}
/** 表の行。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface TableRowArea extends BlockLikeArea {
  type: 'table-row';
  /** ヘッダ繰り返しで複製された行か */
  isRepeatedHeader: boolean;
}
/** 表。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface TableArea extends BlockLikeArea {
  type: 'table';
  /** 列の幅 (pt。左の列から) */
  columnSizes: number[];
  /** ページをまたいだ場合の継続断片か */
  isContinuation: boolean;
}

/** ページの本文の領域。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface RegionBodyArea extends BlockLikeArea {
  type: 'region-body';
}

/** ページ (仕上がりの大きさ)。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface PageArea extends AreaBase {
  type: 'page';
  /** ページ番号の数 (振り直し (XSL-FO の initial-page-number・CSS の counter-reset: page) を反映したもの。シートの順の番号ではない) */
  pageNumber: number;
  /**
   * ページ番号の書式 (XSL-FO の page-sequence の format、CSS の余白の箱の counter(page, <型>) の型。"i"・"I"・"a"・"A"・"01"・"一"・"①" など。
   * 前後の字も含む。pageNumber.ts の formatPageNumber の書式)。10 進 ("1") のページには無い。PDF のページラベル (/PageLabels) を書くのに使う
   */
  pageNumberFormat?: string;
  /** 通常フローの本文領域 */
  regionBody: RegionBodyArea;
  /** フローから切り離された絶対配置 (PageArea 原点基準) */
  absoluteAreas: BlockAreaLike[];
  /** 本文より背面の絶対配置 (リージョンの背景色など)。PageArea 原点基準 */
  behindAreas: BlockAreaLike[];
  /** 仕上がり (trim) 矩形: PageArea ローカル座標では (0,0,width,height) */
}

export type BlockAreaLike = BlockArea;

/** 用紙 (仕上がり・塗り足し・トンボの領域を含む。ページごとに 1 枚)。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある */
export interface SheetArea extends AreaBase {
  type: 'sheet';
  /** Sheet 全体 = 仕上がり + 塗り足し + トンボ領域 (pt) */
  page: PageArea;
  /** PageArea (仕上がり左上) の Sheet 内オフセット */
  trimOrigin: { x: number; y: number };
  /** 仕上がり矩形 (Sheet ローカル) */
  trimBox: Rect;
  /** 塗り足しを含む矩形 (Sheet ローカル) */
  bleedBox: Rect;
  /** 背景色・背景画像を描く範囲 (PageMaster.backgroundArea が content のとき。無ければ bleedBox) */
  backgroundBox?: Rect;
  bleed: number;
  trimMarks: boolean;
  trimMarkMargin: number;
  /** 辺ごとのトンボ領域の幅 (pt) */
  trimMarkMargins?: { top: number; right: number; bottom: number; left: number };
  cornerMarks?: boolean;
  centerMarks?: boolean;
  trimMarkLineWidth?: number;
  backgroundColor?: string;
  /** 用紙全体の背景画像 (PageMaster.backgroundImage。width / height は画像本来の大きさで決めたもの) */
  backgroundImage?: BackgroundImage & { width: number; height: number };
  /** 背景画像の位置の基準の領域 (PageMaster.backgroundOrigin。Sheet ローカル)。無ければ、描く範囲 (backgroundBox か bleedBox) */
  backgroundOriginBox?: Rect;
}

/** 矩形 (pt。y は下向き) */
export interface Rect {
  /** 左の位置 */
  x: number;
  /** 上の位置 */
  y: number;
  /** 幅 */
  width: number;
  /** 高さ */
  height: number;
}

/** Area Tree の節 (type で種類を見分ける) */
export type Area =
  | SheetArea
  | PageArea
  | RegionBodyArea
  | BlockArea
  | LineArea
  | InlineArea
  | GlyphArea
  | TableArea
  | TableRowArea
  | TableCellArea
  | RubyArea
  | TateChuYokoArea
  | ImageArea;

/** 飛び先のシートを解決したしおり */
export interface BookmarkArea {
  /** しおりの題 */
  title: string;
  /** 飛び先のシート (0 始まり)。見つからなければ -1 */
  sheet: number;
  /** 文書の外への飛び先 (URL か、相対のファイル)。文書の中の飛び先 (sheet) が無いしおりだけが持つ。扱いはリンクの external と同じ */
  external?: string;
  /** 初めから開いておくか (子を見せる) */
  open: boolean;
  /** 子のしおり */
  children: BookmarkArea[];
}

/**
 * 組んだ結果 (Area Tree)。TypesetResult.areaTree。ページごとの用紙 (sheets) の木と、文書の情報・しおり・リンクの飛び先・使った書体と画像。
 * walkAreaTree でたどり、serializeAreaTree・parseAreaTree で JSON にして読み書きできる。欄の意味・単位 (pt)・座標の決まりは、リポジトリの docs/area-tree.md (組んだ結果の形) にある
 */
export interface AreaTree {
  /** 形の版 (areaTree.ts の AREA_TREE_SCHEMA_VERSION)。座標・単位の決まりも areaTree.ts の冒頭に書いてある */
  schemaVersion: number;
  /** 文書の題 (HTML の title・XSL-FO の文書情報) */
  title?: string;
  /** 文書の情報 (著者・主題・キーワードなど) */
  info?: DocumentInfo;
  /** しおり (PDF のしおり) */
  bookmarks?: BookmarkArea[];
  /** 文書内リンクの飛び先: id → シートの番号 (0 始まり) */
  destinations?: Record<string, number>;
  /** ページごとの用紙 (ページの順) */
  sheets: SheetArea[];
  /** レイアウト中の警告 (行溢れ等) */
  warnings: string[];
  /**
   * レイアウト中の診断 (warnings と同じ出来事を、名前・重さ・args で持つ。diagnostics.ts)。同じものは 1 件にして数える。
   * 診断の無い木には無い
   */
  diagnostics?: import('./diagnostics').Diagnostic[];
  /** 木が使う書体と画像の一覧 (識別に SHA-256) */
  resources?: AreaResources;
  /** タグ付き PDF の構造の木と、Area の sourceRef → 構造の節の番号の表 (structure.ts)。入力が構造の木を持つときだけある */
  structure?: import('./structure').AreaStructure;
  /** 先頭から maxPages ページで止めた木 (TypesetOptions.maxPages) だけにある。止めない木には無い */
  truncated?: { maxPages: number };
}

/** 木が使う書体と画像の一覧 (AreaTree.resources) */
export interface AreaResources {
  /** 書体 */
  fonts: FontResource[];
  /** 画像 */
  images: ImageResource[];
}

/** 木が使う書体 */
export interface FontResource {
  /** GlyphArea.fontId で指す名前 */
  id: string;
  /** 書体のファミリー名 */
  family: string;
  /** 書体の太さ (100〜900) */
  weight: number;
  /** name 表の PostScript 名 (あれば) */
  postscriptName?: string;
  /** 書体のファイルのバイト列の SHA-256 (16 進)。可変フォントの実体は、実体にした静的な書体のバイト列のもの (glyphIds・glyphPositions は、この書体での値) */
  sha256: string;
  /** 1 em の単位 (head の unitsPerEm) */
  unitsPerEm: number;
  /** 可変フォントの実体のとき: 軸の値 (札 → 値。書体のすべての軸) */
  variation?: Record<string, number>;
  /** 可変フォントの実体のとき: 元の書体のファイル (可変フォント) のバイト列の SHA-256 (16 進) */
  sourceSha256?: string;
}

/** 木が使う画像 (ImageArea.src・背景画像の src) */
export interface ImageResource {
  /** 画像の名前 (ImageArea.src と同じ) */
  src: string;
  /** 画像の MIME タイプ */
  mime?: string;
  /** 画像のファイルのバイト列の SHA-256 (16 進)。バイト列が無い (大きさだけの登録) なら無い */
  sha256?: string;
  /** 自然な大きさの幅 (CSS px) */
  width?: number;
  /** 自然な大きさの高さ (CSS px) */
  height?: number;
}

// ───────────────────────── フォント ─────────────────────────

/** 既定の書体の指定 (TypesetOptions.loadFont に渡すもの。DEFAULT_FONTS) */
export interface FontSpec {
  /** 書体のファミリー名 (Noto Serif JP など) */
  family: string;
  /** 書体の太さ (100〜900。省けば 400) */
  weight?: number;
  /** TTF/OTF の URL (複数なら順にフォールバック) */
  urls: string[];
}

/**
 * OS の書体を探す部品 (TypesetOptions.systemFonts)。Node では kumiori/node の createSystemFonts() が作る。
 * 読み込んだどの書体にも字形の無い字を持つ書体を探す (CSS Fonts 4 §5.2 の処理系の後備の書体)
 */
export interface SystemFontSource {
  /** 字形の無い字 (request.chars) を持つ書体を探す。見つからない字は、返す書体に入れない。探せなければ空の並び */
  find(request: SystemFontRequest): Promise<SystemFontMatch[]>;
}

/** 書体の種類。serif: 明朝・セリフ体、sans: ゴシック・サンセリフ体、other: 手書き・装飾・記号の書体、unknown: 分からない */
export type SystemFontKind = 'serif' | 'sans' | 'other' | 'unknown';

/** SystemFontSource.find に渡す求め */
export interface SystemFontRequest {
  /** 読み込んだどの書体にも字形の無い字 (符号位置 1 つの字。重ならず、符号位置の順) */
  chars: string[];
  /** 文書の言語 (BCP 47)。漢字の書体を選ぶ手がかりにする (無ければ日本語) */
  lang?: string;
  /**
   * 探す書体の種類 (既定 ['serif', 'sans'])。種類ごとに、chars を覆う書体を選ぶ: その種類の書体を先に、覆えなかった字は
   * 種類の分からない書体、ほかの種類の書体の順で補う
   */
  kinds?: readonly SystemFontKind[];
  /**
   * 種類ごとに探す字 (chars のうち、その種類の書体を指定した所に出る字)。種類が無い項は chars の全部を探す。
   * 組版は、明朝の文脈にしか無い字にゴシックの書体を要らないので、要らない書体を選ばない (読み込まない) ために渡す
   */
  charsByKind?: Partial<Record<SystemFontKind, readonly string[]>>;
  /** 返す書体 (埋め込める書体) の数の上限 */
  maxFaces?: number;
  /** 呼び出しの止める合図 */
  signal?: AbortSignal;
}

/** SystemFontSource.find が返す書体 */
export interface SystemFontMatch {
  /** 同じ書体の印 (実体のパス・TTC の中の番号・大きさ・更新の時刻)。文書をまたいで、読み込んだ書体を使い回すのに使う */
  key: string;
  /** 知らせに出す名前 (書体のファミリー名とファイル名) */
  name: string;
  /** この書体で組む字 (request.chars のうち、この書体が持つもの) */
  chars: string[];
  /** この書体の種類 (OS/2 の panose・sFamilyClass と名前から決めたもの)。組版は、指定の書体と同じ種類の書体を先に使う */
  kind: SystemFontKind;
  /** どの種類の求め (request.kinds) に選ばれた書体か (いくつかの求めに選ばれたら、初めのもの。種類の合う書体が無くて補ったときは kind と違う) */
  forKind: SystemFontKind;
  /**
   * PDF に埋め込めるか (OpenType の OS/2 の fsType)。false の書体は、字を持つが使えないことを知らせるためだけに返す
   * (data を呼ばない。chars は、埋め込める書体のどれも持たない字)
   */
  embeddable: boolean;
  /** 書体の中身 (TTC なら、取り出した 1 つの書体の sfnt)。初めて使うときに 1 度だけ呼ぶ */
  data(): Promise<ArrayBuffer>;
}
