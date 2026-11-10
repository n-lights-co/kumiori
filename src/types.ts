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

/** 下線・上線・取り消し線の線の種類 (CSS の text-decoration-style) */
export type TextDecorationStyle = 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';

/** 線種。dot-dash (一点鎖線)・dot-dot-dash (二点鎖線)・wave (波線) はアンテナハウスの拡張 */
export type BorderLineStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'groove' | 'ridge' | 'inset' | 'outset' | 'hidden' | 'dot-dash' | 'dot-dot-dash' | 'wave';

export interface BorderSide {
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
   * 線はこの太さで、箱の外へ (paintWidth − width) だけはみ出して描く (グリッド線を中心に描くため)
   */
  paintWidth?: number;
  /** 罫線の幅 (width) だけ場所を取り、線は描かない (隣のセルが描く) */
  noPaint?: boolean;
  /** 表の外周にあるセルの辺。角の突き合わせを、表の外の角だけにするのに使う */
  tableEdge?: boolean;
}
/** 入力用: 全辺共通 or 辺ごと */
export type BorderInput = BorderSide | Partial<Record<keyof Edges, BorderSide>>;

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

export interface TextStyle {
  fontFamily?: string;
  /** pt */
  fontSize?: number;
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
  /** 約物の連続 (」「 や 。」 など) を詰める (JLREQ §3.1.4)。既定 true */
  punctuationSqueeze?: boolean;
  /**
   * 行の調整 (追込み) で詰める量 (語間・約物のアキ・和欧間のアキの合計) の 1 行あたりの上限 (字の大きさに対する比)。
   * 既定は無制限 (JLREQ §3.8.3)。アンテナハウス互換は 0.5 (二分: 約物 1 つ分までしか追い込まない)
   */
  lineSqueezeMax?: number;
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
   * (axf:punctuation-trim の end-except-fullstop: 「end と同じですが、次の2文字を除外します」)
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
   * 上下の比率の違う書体 (明朝と Times など) が混ざる行は、わずかに高くなる。既定 false (どの字も em の箱で揃える)
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
   * ほかの書体は、字幅の違う書体を持たないので、横書きの字形を水平に拡縮する
   */
  fontStretch?: number;
  /**
   * 斜体。傾きの軸 (ital・slnt) を持つ可変フォントは、その軸の値にする (CSS Fonts 4 §2.4・§5.2)。
   * ほかの書体は、実フォントの斜体を持たないので、描画時に傾斜 (疑似斜体) をかける
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
  /** 画像の大きさ (pt)。省略は画像本来の大きさ (px × 0.75) */
  width?: number;
  height?: number;
  /**
   * background-size の百分率 (0〜1 の割合)。背景の配置の領域 (padding box) の幅・高さに対する割合で、組版で箱の大きさが決まってから
   * width・height にする (CSS Backgrounds 3 §2.9)。片方だけのときは、もう片方を画像の縦横比 (aspect = 幅 / 高さ) で決める
   */
  widthPct?: number;
  heightPct?: number;
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
}

/** 角丸 (アンテナハウスの axf:border-radius)。四隅を半径 rx (水平)・ry (垂直) の楕円で丸める */
export interface BorderRadius {
  rx: number;
  ry: number;
  /**
   * 角ごとの半径 (左上・右上・右下・左下の順に [水平, 垂直])。あれば rx・ry より優先する (CSS の border-*-radius)。
   * 百分率は箱の幅 (水平)・高さ (垂直) に対して。隣り合う半径の和が辺より長ければ、すべてを同じ比で縮める
   */
  corners?: Array<[number | `${number}%`, number | `${number}%`]>;
}

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
   * ブロック・表・セル・絶対配置の箱で効く (行内の箱の背景には効かない)
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
  /** block 方向の内容の寸法の最大値 (pt。max-height。aspect-ratio の箱でだけ使う: 比から出した大きさを抑える。CSS Sizing 4 §5.1) */
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
  sequences: LPageSequence[];
  /**
   * 隣り合う余白 (space / margin) の解決の規則。
   * 'xsl': XSL 1.1 §4.3.1 (同じ優先度の中で最も大きい値。符号も含めて比べる)。
   * 省略: CSS の margin の相殺 (正の最大と負の最小の和)
   */
  spaceResolution?: 'xsl';
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
  /** ページ番号の偶奇 (initialPageNumber を考慮) */
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
  /** ブロック内の改ページを禁止 (可能な限り) */
  keepTogether?: boolean;
  /** 次のブロックの先頭と同じページに置く (見出しの孤立防止)。次が先頭行だけでも同じページに入ればよい */
  keepWithNext?: boolean;
  /** 直前のブロックの末尾と同じページに置く (直前のブロックに keepWithNext を付けるのと同じ) */
  keepWithPrevious?: boolean;
  /** 回り込み (float) の下へ回り込ませず、指定側の float が終わるまで下げる */
  clear?: 'start' | 'end' | 'both';
  /**
   * 行グリッド (アンテナハウスの axf:baseline-grid / -ah-baseline-grid)。new: この箱の字の大きさと line-height で作る。
   * root: 根元の書式で作る。none: 解除する。中の行のベースラインを行グリッドの位置に揃える
   */
  baselineGrid?: 'new' | 'root' | 'none';
}

export interface LInline extends BaseNode {
  type: 'inline';
  children: LInlineLevel[];
  /** 行を分ける改行 (children は '\n')。行頭 (空の行になるとき) では無視する (行内の要素のブロックの ::before / ::after) */
  softBreak?: boolean;
  /**
   * font-variant-caps の small-caps (small) / all-small-caps (all)。書体が smcp (all は c2sc も) を持てばその字形を使い、
   * 持たなければ小文字 (all は大文字も) を、字の大きさの 0.7 倍の大文字で代わりに組む (Fonts 4 §6.6 の合成)
   */
  smallCaps?: 'small' | 'all';
  /** インライン背景 (ハイライト) */
  backgroundColor?: string;
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
  /** ベースラインからの上げ下げ (super / sub / pt。正が上)。文字サイズは別に fontSize で指定する */
  baselineShift?: 'super' | 'sub' | number;
  /** 文字を囲む罫線・内側の余白 (fo:inline の border / padding)。行をまたぐときは、切れ目の辺は描かない */
  border?: BorderInput;
  padding?: EdgesInput;
  /** 行をまたぐ枠の切れ目にも、罫線・内側の余白を付ける (CSS の box-decoration-break: clone。CSS Fragmentation 3 §5.4) */
  boxDecorationBreak?: 'clone';
  /** 角丸 (CSS の border-radius)。枠の罫線と背景を丸め、中の画像も内側の角丸で切り抜く */
  borderRadius?: BorderRadius;
  /** 外側の空き (pt)。行の進む方向の始端 (start) と終端 (end) に、枠の外の空白を置く (CSS の inline 要素の左右の margin) */
  inlineMargin?: { start?: number; end?: number };
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
   * 上側 (縦書きは右) に置く。無ければ、rubyText が上側 (縦書きは右)、rubyTextUnder が下側
   */
  rubyPosition?: 'under';
  /**
   * 2 段目 (rubyTextUnder)・親文字の字の配り方 (CSS Ruby 1 §4.3 の ruby-align)。注釈 (rubyText) の配り方は rubyAlign (TextStyle)。
   * 無ければ、まわりから継承した rubyAlign
   */
  rubyAlignUnder?: RubyAlign;
  rubyAlignBase?: RubyAlign;
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
  /** 角丸 (CSS の border-radius): 画像を角丸で切り抜く (CSS Backgrounds 3 §5.3)。百分率は画像の箱の大きさに対して */
  borderRadius?: BorderRadius;
  width?: number;
  height?: number;
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
  /** 回転 (反時計回り)。回した後の外接矩形が行内の箱の寸法になる (下端を基線に揃える) */
  rotation?: Rotation;
  /** この箱を PDF のフォームの欄にする (中身は空にして、画面には欄の見本を描く) */
  formField?: FormField;
  /** 固定の高さ (幅) の中での内容の配置 (display-align)。既定 start */
  blockAlign?: 'start' | 'center' | 'end';
  /** 行の中での揃え。既定 baseline (中の最初の行の基線を行の基線に)。central は字面の中央、before-edge / after-edge は字面の上端 / 下端 */
  alignmentBaseline?: 'baseline' | 'central' | 'before-edge' | 'after-edge';
  /** baseline で揃えるときの、箱の基線。既定 first (中の最初の行)。last は最後の行 (CSS の inline-block。切り抜く箱・行の無い箱は下端) */
  baselineFrom?: 'first' | 'last';
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
  initialLetter?: { size: number; sink: number; align?: 'alphabetic' | 'ideographic' | 'leading' };
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
  /** CSS の clear (cssPlacement のとき): その側の先の float の下に置く (CSS 2.1 §9.5.2) */
  clear?: 'start' | 'end' | 'both';
  /** CSS の min-width・max-width (pt。内容の幅。cssPlacement で幅の指定が無いとき、shrink-to-fit の幅を抑える。下限が勝つ) */
  minWidth?: number;
  maxWidth?: number;
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
  /** 本文中の参照記号の書体・太さ・斜体・色・飾り線 (XSL-FO の参照側の fo:inline の指定)。省略は置く所の書式 */
  referenceStyle?: Pick<BaseNode, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'color' | 'textDecoration'>;
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
   * absolutePosition の基準を、ページではなく、いちばん近い祖先のブロックコンテナの内容の箱にする
   * (left・top・right・bottom はその箱の左上・右下からの距離)。横書きのコンテナの中だけで効く
   */
  positionInContainer?: boolean;
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
   * 中身の幅が組むまで決まらない列に使う: ページ番号の引用 (target-counter(…, page)) を持つ flex の項目は、番号の桁の数が
   * 組んでみるまで分からない (読み込みのときの見積もりの幅のままだと、桁が増えたときに番号が箱からはみ出すか、折り返す)。
   * 幅の変わった分は、同じ表の比例 ('N*') の列が受ける
   */
  fitContent?: boolean;
}

export interface LTableCell extends BaseNode, BoxStyle {
  type: 'table-cell';
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
  /** 行をページの途中で分割しない (既定では、ページに入らない行はセルの中身を行単位で次ページへ分ける) */
  keepTogether?: boolean;
  /** 行の高さの最小値 (pt。fo:table-row の height / block-progression-dimension、CSS の tr の height) */
  minHeight?: number;
  /** 行の高さの最大値 (pt。block-progression-dimension.maximum)。中身はそれを超えてもはみ出して描く */
  maxHeight?: number;
  /** 行の前後の余白 (pt。fo:list-item の space-before / space-after)。隣の行・表の前後の余白と重ね合わせる */
  spaceBefore?: number;
  spaceAfter?: number;
  /** この行の前・後で改ページする (CSS の tr の break-before・break-after: page など) */
  breakBefore?: boolean;
  breakAfter?: boolean;
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

export interface LTable extends BaseNode, BoxStyle {
  type: 'table';
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
   * 'max-ratio': 各列の最大の長さ (使える幅で頭打ち) の比で配る (XSL-FO の表)
   * 'ah-html': 最大の長さが均等割り (使える幅 ÷ 列の数) 以下の列は最大の長さのまま。残りの列は、最小の長さに、
   * 残りの幅の最小の長さの合計からの余りを最大の長さの比で足す (HTML の入力のアンテナハウス互換)
   */
  fitContentRule?: 'interpolate' | 'max-ratio' | 'ah-html';
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

export interface GlyphArea extends AreaBase {
  type: 'glyph';
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
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
   * 色つきの字形のパレットの選び方 (CSS の font-palette と @font-palette-values の結果。colorGlyph.ts の FontPalette)。
   * 既定のパレット (font-palette: normal) のときは付かない。色つきの表 (COLR/CPAL) を持つ書体の字だけに効く
   */
  fontPalette?: { base?: number | 'light' | 'dark'; colors?: Array<[number, string]> };
}

export interface InlineArea extends BlockLikeArea {
  type: 'inline';
}

export interface ImageArea extends AreaBase {
  type: 'image';
  src: string;
  /** 画像データが無い (プレースホルダを描く) */
  missing: boolean;
  alt?: string;
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

export interface RubyArea extends AreaBase {
  type: 'ruby';
  /** 親文字 glyph 群 (RubyArea ローカル座標) */
  base: GlyphArea[];
  /** ルビ glyph 群 */
  ruby: GlyphArea[];
  /** ルビが占める block 方向の厚さ (pt) */
  rubyExtent: number;
}

export interface TateChuYokoArea extends AreaBase {
  type: 'tate-chu-yoko';
  /** 横組みで並べた各文字 (TateChuYokoArea ローカル座標) */
  glyphs: GlyphArea[];
  /** 全角 1 文字枠に収めるための水平圧縮率 (1 = 圧縮なし) */
  scale: number;
  /** 占有する全角枠数 */
  frames: number;
}

export interface LineArea extends BlockLikeArea {
  type: 'line';
  /** 行内の inline-progression 方向の使用長 */
  contentLength: number;
  hasRuby: boolean;
}

export interface BlockArea extends BlockLikeArea {
  type: 'block';
  /** ページをまたいだ場合の継続断片か */
  isContinuation: boolean;
  /** 後続ページに続くか */
  continuesOnNext: boolean;
}

export interface TableCellArea extends BlockLikeArea {
  type: 'table-cell';
}
export interface TableRowArea extends BlockLikeArea {
  type: 'table-row';
  /** ヘッダ繰り返しで複製された行か */
  isRepeatedHeader: boolean;
}
export interface TableArea extends BlockLikeArea {
  type: 'table';
  columnSizes: number[];
  isContinuation: boolean;
}

export interface RegionBodyArea extends BlockLikeArea {
  type: 'region-body';
}

export interface PageArea extends AreaBase {
  type: 'page';
  pageNumber: number;
  /** 通常フローの本文領域 */
  regionBody: RegionBodyArea;
  /** フローから切り離された絶対配置 (PageArea 原点基準) */
  absoluteAreas: BlockAreaLike[];
  /** 本文より背面の絶対配置 (リージョンの背景色など)。PageArea 原点基準 */
  behindAreas: BlockAreaLike[];
  /** 仕上がり (trim) 矩形: PageArea ローカル座標では (0,0,width,height) */
}

export type BlockAreaLike = BlockArea;

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
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  title: string;
  /** 飛び先のシート (0 始まり)。見つからなければ -1 */
  sheet: number;
  /** 文書の外への飛び先 (URL か、相対のファイル)。文書の中の飛び先 (sheet) が無いしおりだけが持つ。扱いはリンクの external と同じ */
  external?: string;
  open: boolean;
  children: BookmarkArea[];
}

export interface AreaTree {
  /** 形の版 (areaTree.ts の AREA_TREE_SCHEMA_VERSION)。座標・単位の決まりも areaTree.ts の冒頭に書いてある */
  schemaVersion: number;
  title?: string;
  info?: DocumentInfo;
  bookmarks?: BookmarkArea[];
  /** 文書内リンクの飛び先: id → シートの番号 (0 始まり) */
  destinations?: Record<string, number>;
  sheets: SheetArea[];
  /** レイアウト中の警告 (行溢れ等) */
  warnings: string[];
  /** 木が使う書体と画像の一覧 (識別に SHA-256) */
  resources?: AreaResources;
}

export interface AreaResources {
  fonts: FontResource[];
  images: ImageResource[];
}

/** 木が使う書体 */
export interface FontResource {
  /** GlyphArea.fontId で指す名前 */
  id: string;
  family: string;
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
  src: string;
  mime?: string;
  /** 画像のファイルのバイト列の SHA-256 (16 進)。バイト列が無い (大きさだけの登録) なら無い */
  sha256?: string;
  /** 自然な大きさ (CSS px) */
  width?: number;
  height?: number;
}

// ───────────────────────── フォント ─────────────────────────

export interface FontSpec {
  family: string;
  weight?: number;
  /** TTF/OTF の URL (複数なら順にフォールバック) */
  urls: string[];
}
