/**
 * inlineLayout — インライン整形
 *   1. flattenInline : 論理インライン木 → Atom 列 (文字 / ルビ / 縦中横)。本体は inlineFlatten.ts (ここから再 export)
 *   2. breakLines    : 禁則 (行頭・行末・分離禁止) + ぶら下げ + 追い出し付きの行分割 (改行の機会は markLineBreaks が UAX #14 で付ける)
 *   3. positionLine  : 行内配置 (均等割付 / 中央 / 末尾揃え)
 *   4. lineMetrics   : 行の高さ (基線の上下・半行間)。本体は lineMetrics.ts (ここから再 export)
 *   5. buildLineNode : 行 → LNode (Line > Inline > Glyph/Ruby/TCY)
 * Atom と、その周りの型 (InlineFrame・BoxSpec・LeaderSpec・FlattenState・RawLine・PositionedLine) はここで定める
 */
import type { Annotation, LinkTarget, LFootnote, LFootnoteCitation, LImage, LInline, LInlineContainer, LLeader, LPageNumberCitation, LRuby, LTateChuYoko, RubyAlign } from './types';
import type { GlyphMetrics, Measurer, RubyMetrics, TateChuYokoMetrics } from './measurer';
import { isClosingPunct, isHangable, isIdeographicOrKana, isLatinAlnum, isLineEndProhibited, isLineHeadProhibited, isMiddlePunct, isOpeningPunct } from './jis';
import { complexContextBreaks, lineBreakActions, type LineBreakOptions } from './lineBreak';
import { newNode, type LNode, type ResolvedStyle } from './lnode';
import type { BorderLineStyle, BorderRadius, BorderStyle, Edges, WritingMode } from './types';
import { borderToLogicalWidths, toLogical } from './geometry';
import { mirrorChar, resolveLevels, visualOrder } from './bidi';
import { atomAboveBelow, DEFAULT_BASELINE_RATIO, lineMetrics, type LineMetrics } from './lineMetrics';
import { hyphenationLetters } from './hyphenation';
import { bidiControls, flattenInline, joiningUnits, ligatureUnits, primaryChar, runStyleOf } from './inlineFlatten';

// inline の木を atom に平らにする処理 (inlineFlatten.ts) も、ほかのファイルからは従来どおりここから使える
export { bidiControls, flattenInline, joiningUnits, ligatureUnits, primaryChar, runStyleOf };

// 行の高さ (lineMetrics.ts) は、ほかのファイルからは従来どおりここから使える
export { DEFAULT_BASELINE_RATIO, lineMetrics, type LineMetrics };

export type InlineChild = string | LInline | LRuby | LTateChuYoko | LLeader | LFootnote | LPageNumberCitation | LImage | LInlineContainer | LFootnoteCitation;

export interface Atom {
  kind: 'glyph' | 'ruby' | 'tcy' | 'leader' | 'box' | 'break';
  /** 代わりの書体の字のとき、最初に使える書体の基線の比 (primaryFontMetrics の行の高さに使う) */
  primaryRatio?: number;
  /** 代わりの書体の字のとき、最初に使える書体の上下 (ascent・descent) と基線の比 (XSL の行の高さに使う: 和文の代わりの書体の字で基線を動かさない) */
  primaryFont?: { ascent?: number; descent?: number; baselineRatio: number };
  /** 中身の無い inline の目印 (id の位置だけを記録する幅 0 の箱) */
  idMark?: boolean;
  /** 最小の幅を測る組み方 (min-content) の字。overflow-wrap: break-word の語の途中を分割点に数えない (Text 3 §5.5) */
  intrinsic?: boolean;
  first: string;
  last: string;
  /**
   * 2 字以上の字の単位 (書記素クラスタ。UAX #29) をまとめた字: 並び全体 (基底の字 + 結合文字、絵文字の並びなど)。
   * first・last は基底の字 (並びの最初の字) で、字の種類で決まる処理 (禁則・約物の詰め・和欧間のアキ) は基底の字で行う
   */
  cluster?: string;
  /** 字ごとに分けて組んだクラスタの 2 つ目以降の字 (どの書体も並び全体を持たないとき)。前の字と同じ字の単位で、前では行を分けない (glue も付く) */
  clusterCont?: boolean;
  advance: number;
  isSpace: boolean;
  runId: number;
  /** page-number-citation の字 (参照の引数の鍵) */
  cite?: string;
  st: ResolvedStyle;
  bg?: string;
  g?: GlyphMetrics;
  r?: RubyMetrics;
  /** ルビの字の色 [上側, 下側] (LRuby.rubyColor・rubyColorUnder。rubyPosition: 'under' なら入れ替えたもの)。無ければ字の色 */
  rubyColors?: [string | undefined, string | undefined];
  /** 字の配り方 [上側のルビ, 下側のルビ, 親文字] (LRuby.rubyAlign・rubyAlignUnder・rubyAlignBase)。無ければ、これまでの配り方 (distribute) */
  rubyAligns?: [RubyAlign | undefined, RubyAlign | undefined, RubyAlign | undefined];
  t?: TateChuYokoMetrics;
  leader?: LeaderSpec;
  box?: BoxSpec;
  /**
   * 欧文の書体で組む語の字: ギリシャ文字・キリル文字が 2 字以上続く語の字 (inlineFlatten.ts の markLatinWords)。書体・字の組の詰め・
   * 和欧間のアキ・分綴を、ラテン文字の語と同じに扱う
   */
  latinWord?: boolean;
  /** 幅 0 で字形を描かない字 (単独の ZWNJ・LRM・RLM など。Default_Ignorable_Code_Point)。双方向の並べ替え・改行の決まりには加わる */
  hidden?: boolean;
  /** 直前と同じ語の一部 (脚注の参照記号など)。この atom の前では改行しない */
  glue?: boolean;
  /** この atom の前で改行してよいか (UAX #14 で段落ごとに決めたもの。markLineBreaks) */
  lbBefore?: boolean;
  /** lbBefore が、辞書で決めた語の境目 (タイ語など、語の間に空白を書かない用字。complexContextBreaks) による */
  lbDict?: boolean;
  /** vertical-align: top・bottom の箱: 行の高さを決めてから、行の箱の上端・下端に揃える (lineMetrics) */
  lineAlign?: 'top' | 'bottom';
  /** 前で改行してよいが、ほかに改行できる位置が無いときだけ使う (斜線の後ろ。UAX #14 §5.1 SY の推奨。lineBreakActions の soft) */
  lbSoft?: boolean;
  /** 表のセルの最小の幅を測るとき、前後で改行しない画像 (LImage.noWrapInCellMin) */
  noWrapInCellMin?: boolean;
  /** 行頭 (空の行になるとき) では無視する強制改行 (行内の要素のブロックの ::before / ::after。LInline.softBreak) */
  soft?: boolean;
  /** block-start 方向 (横書きは上・縦書きは右) への持ち上げ量 pt */
  shift?: number;
  /** ルビのはみ出し: 前 (ovL)・後ろ (ovR) の字に掛けた長さ。advance からは差し引き済み (行頭・行末では掛けない) */
  ovL?: number;
  ovR?: number;
  /** advance の末尾に足した和欧間アキ。行末に来たら捨てる (行末の字の後ろにアキを残さない) */
  trail?: number;
  /** 分綴: この字の後ろで、ハイフン (この atom) を付けて行を分けてよい */
  hyphen?: Atom;
  /** この字の後ろにソフトハイフン (U+00AD) がある (その語は自動の分綴をしない。CSS Text 3 §5.3) */
  softHyphen?: boolean;
  /** 字形を inline 方向にずらす量 (始め括弧類の前のアキを詰めたとき、字面を前へ寄せる) */
  dx?: number;
  /** letter-spacing の字の前・後ろの半分 (XSL §7.17.2。advance に含む。行頭・行末に来たら捨てる) */
  lsLead?: number;
  lsTrail?: number;
  /** 段落の 1 行目の先頭の字 (行頭の始め括弧の前のアキを詰めるか決める) */
  paraStart?: boolean;
  /** 強制改行の直後の行の先頭の字 (axf:punctuation-trim の start-except-first で、行頭を詰めない行) */
  afterBreak?: boolean;
  /** 罫線・余白つきの inline の始まり / 終わり (この atom の送りが、始端 / 終端の余白 + 罫線) */
  frameOpen?: InlineFrame;
  frameClose?: InlineFrame;
  /** この atom を囲む枠 (外側から) */
  frames?: InlineFrame[];
  /** この atom (参照記号の先頭) を含む行が置かれたページに、脚注本体も置く */
  fnRef?: LFootnote;
  src?: string;
  /** 双方向の埋め込みの深さ (UAX #9。markBidi で付ける。偶数は左から右、奇数は右から左) */
  bidiLevel?: number;
  /** L1 で段落の深さに戻す字: 1 = 空白 (WS・隔離の制御)、2 = 区切り (S・B) */
  bidiReset?: 1 | 2;
  /** 元の入力の節の通し番号 (sourceRef.ts)。字を含む inline (無ければ block) */
  ref?: number;
  /** この atom の前・後ろに入れる双方向の制御文字 (unicode-bidi の inline の始まり・終わり。Writing Modes 3 §2.4.2) */
  bidiOpen?: number[];
  bidiClose?: number[];
  /** 段落の埋め込みの深さ (markBidi が決めたもの) */
  bidiPara?: number;
}

/** 行内に置く箱 (画像・inline-container)。寸法は行の書字方向に対する値 */
/** 罫線・余白つきの inline (文字を囲む枠) */
export interface InlineFrame {
  id: number;
  /** 物理辺の罫線と余白 */
  border: BorderStyle;
  padding: Edges;
  bg?: string;
  /** 角丸 (border-radius)。枠の罫線と背景を丸め、中の画像も丸めて切り抜く */
  radius?: BorderRadius;
  /** 罫線・余白を描く枠か (false ならリンク・注釈の範囲だけを示す) */
  box: boolean;
  link?: LinkTarget;
  annot?: Annotation;
  /** 枠の最初の atom (注釈は、これを含む行にだけ付ける) */
  first?: Atom;
}

export interface BoxSpec {
  node: LNode;
  /** inline 方向の送り */
  adv: number;
  /** block 方向の厚み */
  cross: number;
  /** 横書き: 箱の上端から基線まで / 下端までの距離 (縦書きは cross/2 ずつ) */
  above: number;
  below: number;
}

export interface LeaderSpec {
  pattern: 'dots' | 'rule' | 'space';
  /** dots の 1 文字 */
  g?: GlyphMetrics;
  /** dots の繰り返しの単位が 2 文字以上のとき (use-content の文字列)、その字の並び。pitch はその送りの合計以上 */
  gs?: GlyphMetrics[];
  pitch: number;
  thickness: number;
  /** rule の線種 (solid 以外) */
  ruleStyle?: BorderLineStyle;
  min: number;
  opt: number;
  max: number;
  /** CSS の leader() (前で改行できる。後ろの内容とは同じ行に置く) */
  css?: boolean;
  /** CSS の leader() の字を、リーダーの始めの端から並べる (LLeader.cssLeaderFromStart) */
  fromStart?: boolean;
}

export interface FlattenState {
  run: number;
  /** ギリシャ文字・キリル文字の語を、欧文の書体に替えない (アンテナハウス互換) */
  noLatinWords?: boolean;
  /** 脚注: ラベル取得と参照記号の縮小率。無ければ '*' だけ出して本体は捨てる */
  footnote?: { label(fn: LFootnote): string; scale: number };
  /** ページ番号参照 (fo:page-number-citation) の解決 */
  cite?: (refId: string, last?: boolean, format?: string, physical?: boolean, style?: ResolvedStyle) => string;
  /** 画像 / inline-container を、行内の箱に組む (Flow が与える) */
  image?: (c: LImage, st: ResolvedStyle) => BoxSpec;
  inlineBox?: (c: LInlineContainer, st: ResolvedStyle) => BoxSpec;
  /** 行を置く領域の inline 方向の寸法 (leader-length の百分率の基準) */
  containerI?: number;
  /** 中身の長さを測っている (表の自動レイアウト)。百分率の長さは決められない */
  intrinsic?: boolean;
}

export function isInlineChild(c: unknown): c is InlineChild {
  if (typeof c === 'string') return true;
  const t = (c as { type?: string }).type;
  return t === 'inline' || t === 'ruby' || t === 'tate-chu-yoko' || t === 'leader' || t === 'footnote' || t === 'page-number-citation' || t === 'image' || t === 'inline-container' || t === 'footnote-citation';
}

// ───────────────────────── 行分割 ─────────────────────────

/**
 * atom 間で改行してよいか。leader の前後は (目次の見出しと頁番号を離さないため) 不可。
 * 改行の機会は、段落ごとに markLineBreaks (UAX #14) が b.lbBefore に付けたものを使う。lbBefore の無い atom は、中身の無い目印 (idMark。
 * glue で先に弾く) と、目印の後ろに来た段落の最初の字だけで、文頭 (UAX #14 の sot) では改行しない
 */
const LETTER = /^[\p{L}\p{N}\p{M}]$/u;
const COMBINING = /^\p{M}$/u;
function canBreakAtoms(a: Atom, b: Atom): boolean {
  // CSS の leader(): 前の内容の後ろ (空白の後) で改行してよい。leader が入らなければ、leader と後ろの内容を次の行に置く (Content 3 §2.5.3)
  if (b.kind === 'leader' && b.leader?.css && a.kind === 'glyph' && /^\p{Zs}$/u.test(a.last)) return true;
  if (a.kind === 'leader' || b.kind === 'leader' || b.glue) return false;
  // 折り返さない (white-space: nowrap・pre) 字どうしの間では改行しない (Text 3 §3)。はみ出すのが nowrap の外の字 (後ろのバッジや空白) でも、
  // nowrap の中のハイフンなどで折り返さない
  if (a.st.noWrap && b.st.noWrap) return false;
  // word-break (Text 3 §5.2): break-all は字と字の間でも改行してよい。keep-all は字と字の間では改行しない
  const wb = b.st.wordBreak ?? a.st.wordBreak;
  // break-all は字を ID として扱う (Text 3 §5.1)。ID でも、行頭に置けない字 (小書きの仮名・長音記号など) の前では改行しない
  // 結合文字・異体字セレクタ (General_Category が M の字) の前は、字の単位 (基底の字 + 結合文字。UAX #29 GB9・GB9a) の中なので、break-all でも分けない
  // (break-all が ID として扱うのは字の単位。Text 3 §5.1)。UAX #14 の機会 (LB9: 結合文字の前は改行しない) に任せる
  // keep-all でも、辞書で決めた語の境目 (タイ語など) では改行してよい (Text 3 §5.1 の word-break の keep-all: 字と字の間の機会を無くすが、
  // 辞書による改行の機会は残す)。break-all は、SA の字も ID と同じに扱う (字の単位の間で改行してよい)
  if (wb && wb !== 'normal' && !(wb === 'keep-all' && b.lbDict) && a.kind === 'glyph' && b.kind === 'glyph' && !a.isSpace && !b.isSpace && LETTER.test(a.last) && LETTER.test(b.first) && !COMBINING.test(b.first))
    return wb === 'break-all' && !isLineHeadProhibited(b.first, b.st.looseLineStart) && !isLineEndProhibited(a.last);
  return b.lbBefore ?? false;
}

/** 改行の調整 (CSS の line-break と、アンテナハウス互換の looseLineStart) */
function lineBreakOptionsOf(st: ResolvedStyle): LineBreakOptions {
  const lb = st.lineBreak;
  const strictness = lb === undefined ? 'strict' : lb === 'auto' ? 'normal' : lb;
  // 斜線の後ろは、次の改行の機会まで 5 字未満なら改行しない (UAX #14 §5.1 SY の推奨。「and/or」「w/o」を分けない)
  return { strictness, cjk: /^(ja|zh)\b/i.test(st.language ?? ''), looseLineStart: !!st.looseLineStart, symbolBreakMinDistance: 5 };
}

/**
 * 段落の atom の並びの、atom と atom の間の改行の機会を、UAX #14 で決める (lbBefore)。
 * 字の atom は字そのもの、行内の箱 (画像など) は U+FFFC、leader も U+FFFC、強制改行は LF、ゼロ幅空白は ZW として並べる。
 * 中身の無い目印 (id の位置) は並びに入れない (前後の字の間の機会を、目印の後ろの atom に付ける)
 */
export function markLineBreaks(atoms: Atom[]): void {
  const cps: number[] = [];
  const optsOf: LineBreakOptions[] = [];
  const langOf: Array<string | undefined> = [];
  const firstIdx: number[] = new Array(atoms.length).fill(-1);
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (a.idMark) continue;
    const o = lineBreakOptionsOf(a.st);
    const push = (cp: number) => {
      cps.push(cp);
      optsOf.push(o);
      langOf.push(a.st.language);
    };
    firstIdx[i] = cps.length;
    if (a.kind === 'break') push(0x0a);
    else if (a.kind === 'box' && a.isSpace && a.advance === 0) push(0x200b);
    else if (a.kind === 'box' || a.kind === 'leader') push(0xfffc);
    else {
      const f = a.first.codePointAt(0) ?? 0xfffc;
      // 字の単位 (書記素クラスタ) の atom は、並びの字をすべて並べる (atom の中の機会は使わない)。結合文字・ZWJ は UAX #14 の LB9 で
      // 基底の字の性質になるので、前後の機会は基底の字で決まる。絵文字の並び・国旗の対 (LB30a・LB30b) も、規則どおりの並びで決まる
      if (a.cluster) for (const c of a.cluster) push(c.codePointAt(0)!);
      else push(f);
      // 合字・ルビなど、字の並びの atom は、最初と最後の字 (atom の中では改行しない)
      if (a.last && a.last !== a.first) push(a.last.codePointAt(0) ?? f);
    }
  }
  const soft: boolean[] = [];
  const act = lineBreakActions(cps, (i) => optsOf[i], soft);
  for (let i = 0; i < atoms.length; i++) {
    const k = firstIdx[i];
    if (k > 0) atoms[i].lbBefore = act[k] !== '×';
    if (k > 0 && soft[k]) atoms[i].lbSoft = true;
  }
  // 語の間に空白を書かない用字 (タイ語など。UAX #14 の SA) の並びの中は、UAX #14 の既定 (AL) では改行の機会が無い。
  // 辞書で決めた語の境目を、改行の機会に足す (UAX #14 §5.1 SA・CSS Text 3 §5)。atom の途中 (字の単位の中) の境目は使わない。
  // SA の字が無ければ dict は null で、何もしない
  const dict = complexContextBreaks(cps, (k) => langOf[k]);
  if (dict) {
    const at = new Set(dict);
    for (let i = 0; i < atoms.length; i++) {
      const k = firstIdx[i];
      if (k > 0 && at.has(k) && act[k] === '×' && !atoms[i].lbBefore) {
        atoms[i].lbBefore = true;
        atoms[i].lbDict = true;
      }
    }
  }
}

export interface RawLine {
  items: Atom[];
  hang?: Atom;
  /** 強制改行または最終行 (均等割付しない) */
  last: boolean;
  /** 空行 (強制改行のみ) のメトリクス用 */
  metric?: Atom;
  indent: number;
}

const EPS = 1e-6;
/**
 * 行に入るかの判定の許容差 (pt)。CSS の計算値は px で小数 4 桁に丸めるので、9.5pt の字は 9.500025pt、16em の幅は 152.000025pt になり、
 * ぴったり入るはずの 16 字がわずかに溢れる。1/1000 pt までは入るとみなす
 */
const FIT_EPS = 1e-3;

/** 行末スペースは捨てて RawLine を作る */
function makeLine(items: Atom[], last: boolean, indent: number): RawLine {
  let e = items.length;
  // white-space-treatment="preserve" などの空白は、行末でも残す (XSL §7.16.8)
  while (e > 0 && items[e - 1].isSpace && !items[e - 1].st.keepLineEndSpace) e--;
  return { items: items.slice(0, e), last, indent };
}

/**
 * atoms[start..] から 1 行を切り出す (禁則・ぶら下げ・追い出し)。
 * 回り込みで行ごとに使える幅が変わる場合に、行を 1 本ずつ組むために使う。
 * @returns line: 切り出した行 / next: 次の行の開始位置 (atoms.length なら終端)
 */
/**
 * 和文の字間の調整 (JLREQ §3.1・§3.2 の基礎部分)。flattenInline の結果に、その場で手を入れる。
 *  - 約物の連続: 終わり括弧類・句読点の後ろに約物が続くとき、前の字の後ろの二分アキを詰める (」「 → 間は二分、。」 → ベタ)。
 *    始め括弧類が続くとき (（「)、後ろの字の前の二分アキを詰める。
 *  - 和欧間アキ (textAutospace): 和文と欧文・数字の間にアキを入れる (既定は四分。textAutospaceWidth で変える)
 *  - ルビのはみ出し (rubyOverhang): 親文字より長いルビを、前後の仮名・約物にルビ文字 1 字分まで掛ける
 *  - ペアカーニング (kerning): 横書きの欧文の字の組に、フォントのカーニングを足す
 */
/**
 * kernAh: アンテナハウス互換。字の組を詰めるのは、同じ inline の中の字どうしだけ (要素の境目では詰めない)
 */
export function adjustJapaneseSpacing(atoms: Atom[], kern?: (a: Atom, b: Atom) => number, kernAh = false) {
  for (let k = 0; k < atoms.length; k++) {
    const a = atoms[k];
    if (a.kind === 'ruby' && a.r && a.st.rubyOverhang && a.st.direction !== 'rtl') rubyOverhang(a, atoms[k - 1], atoms[k + 1]);
    // axf:punctuation-trim="all":
    // 全角の字幅の約物 1 字を二分にする。始め括弧類は前の二分を、終わり括弧類・句読点類は後ろの二分を、中点類は前後の四分ずつを詰める。
    // 半角にした約物は、後の約物の連続の詰め・行頭行末の詰め (字幅が全角のときだけ詰める) の対象にならない
    if (a.kind === 'glyph' && a.st.punctuationTrimAll && a.first === a.last && a.advance > a.st.fontSize * 0.9) {
      const fs = a.st.fontSize;
      if (closingAt(a, a.first)) a.advance -= fs / 2;
      else if (isOpeningPunct(a.first)) {
        a.advance -= fs / 2;
        a.dx = (a.dx ?? 0) - fs / 2;
      } else if (middleAt(a, a.first)) {
        a.advance -= fs / 2;
        a.dx = (a.dx ?? 0) - fs / 4;
      }
    }
  }
  for (let k = 0; k + 1 < atoms.length; k++) {
    const a = atoms[k];
    const b = atoms[k + 1];
    if (a.kind !== 'glyph' || b.kind !== 'glyph') continue;
    const fa = a.st.fontSize;
    const fb = b.st.fontSize;
    // 字の組の詰め (kern): 書式が同じなら、inline の境目をまたいでも詰める (CSS Text 3 §7.3: 書式の実際の変化が無い境目では、
    // 字形の処理を切ってはならない)。上げ下げ (vertical-align) の違う境目では切る。余白・枠のある境目は間に箱の atom が入るので、隣り合わない
    const sameBox = kernAh ? a.st === b.st : (a.shift ?? 0) === (b.shift ?? 0);
    if (kern && a.st.kerning && b.st.kerning && fa === fb && sameBox && ((isLatinAlnumOrPunct(a.last) && isLatinAlnumOrPunct(b.first)) || (isThaiLetter(a.last) && isThaiLetter(b.first)))) a.advance += kern(a, b);
    if (a.st.punctuationSqueeze !== false) {
      // 詰めたときの間隔 (axf:punctuation-spacing。既定は二分)
      const sp = a.st.punctuationSpacing;
      if (closingAt(a, a.last) && (isOpeningPunct(b.first) || closingAt(b, b.first) || middleAt(b, b.first)) && a.advance > fa * 0.9) {
        // 既定 (二分) では 」「 の間は二分、。」 などはベタ。axf:punctuation-spacing の指定があれば、終わり括弧類の後ろのアキを
        // 間隔の分にしてから二分詰める (0.75em なら ）、 は 0.25em 空き、0.25em なら 0.25em 重なる)
        a.advance -= sp !== undefined && !middleAt(b, b.first) ? fa - sp * fa : fa / 2;
      } else if ((isOpeningPunct(a.last) || middleAt(a, a.last)) && isOpeningPunct(b.first) && b.advance > fb * 0.9) {
        // 始め括弧類どうし、中点類の後ろの始め括弧類 (JLREQ 3.1.4: 中点類の後ろに始め括弧類が連続する場合は、前の中点類の後ろを四分アキ)
        // は、後ろの始め括弧類の前の二分アキを詰める
        b.advance -= fb / 2;
        b.dx = (b.dx ?? 0) - fb / 2;
      } else if (sp !== undefined && b.st.punctuationSqueeze !== false) {
        // 約物と約物でない字の間 (二分のアキ) を、間隔の分にする
        if (closingAt(a, a.last) && isPlainChar(b, b.first) && a.advance > fa * 0.9) {
          a.advance -= fa / 2 - sp * fa;
        } else if (isPlainChar(a, a.last) && isOpeningPunct(b.first) && b.advance > fb * 0.9) {
          const d = fb / 2 - (b.st.punctuationSpacing ?? 0.5) * fb;
          b.advance -= d;
          b.dx = (b.dx ?? 0) - d;
        }
      }
    }
    if (a.st.textAutospace && b.st.textAutospace && !a.isSpace && !b.isSpace) {
      // 全角の空白 (U+3000) と、約物・前置省略記号 (＃ ＄)・後置省略記号 (％)・ハイフン類 (～) でない全角形 (全角の英数字・＋ ＝ などの記号。
      // U+FF01〜FF5E) も和字として扱う (JLREQ の cl-22 漢字等。「Q1　情報…」・
      // 「　t」と「FrameMaker ＋ SGML」は四分アキ、「3.4％」「1～10」はベタ)
      const wa = (ch: string) => isIdeographicOrKana(ch) || ch === '\u3000' || (isFullwidthForm(ch) && !isOpeningPunct(ch) && !isClosingPunct(ch) && !isMiddlePunct(ch) && !/^[＃＄％～]$/.test(ch));
      // 欧文の書体で組む語 (ギリシャ文字・キリル文字が 2 字以上続く語) の字も、欧文の字と同じに空ける (単独の 1 字は空けない)
      if ((wa(a.last) && (isLatinAlnum(b.first) || b.latinWord)) || ((isLatinAlnum(a.last) || a.latinWord) && wa(b.first))) {
        const s = Math.min(fa, fb) * (a.st.textAutospaceWidth ?? 0.25);
        a.advance += s;
        a.trail = (a.trail ?? 0) + s;
      }
    }
  }
}

/** 句読点 (、。，．) とコロン類 (：；): 字形の墨の位置で、終わり括弧類の仲間か中点類の仲間かが変わる字 (CSS Text 4 §8.5.3 の fullwidth dot punctuation・fullwidth colon punctuation) */
const DOT_PUNCT = new Set([...'、。，．']);
const COLON_PUNCT = new Set([...'：；']);
/** 墨が字の枠の前半に収まっているとみなす余裕・中央にあるとみなす前後の空き (字の枠に対する比) */
const INK_HALF_TOLERANCE = 0.05;
const INK_MIDDLE_MARGIN = 0.2;
/** 書体ごとの、字 (と縦書きの字形の選び方) の墨の範囲 (字の進む方向。字の枠に対する比。null は分からない) */
const inkSpanMemo = new WeakMap<object, Map<string, [number, number] | null>>();

/**
 * 字形の墨 (輪郭の外接枠) が、字の枠 (全角) の中で字の進む方向のどこにあるか: [始まり, 終わり] (0 が枠の前の端、1 が後ろの端)。
 * 横書きと、縦書きで横倒しにする字は、字形の左右。縦書きで正立にする字は、縦書き用の字形 (書体の vert・Unicode の縦書き用字形) の上下
 * (枠の上端は、基線から baselineRatio だけ上)。書体の字形が引けない字・位置をずらして代える字 (verticalTreatment の dx・dy) は undefined
 */
function inkSpan(g: GlyphMetrics): [number, number] | undefined {
  const font = g.font;
  const v = g.vertical;
  if (!font?.fk || (v && (v.dx !== 0 || v.dy !== 0))) return undefined;
  const upright = !!v && v.mode === 'upright';
  const key = `${upright ? (v!.features?.length ? 'v:' : 'u:') + v!.glyph : 'h:' + g.ch}`;
  let memo = inkSpanMemo.get(font);
  if (!memo) inkSpanMemo.set(font, (memo = new Map()));
  let hit = memo.get(key);
  if (hit === undefined) {
    hit = null;
    try {
      const run = font.fk.layout(upright ? v!.glyph : g.ch, { kern: false, liga: false, clig: false, ...(upright && v!.features?.length ? Object.fromEntries(v!.features.map((f) => [f, true])) : {}) } as never);
      const gl = run.glyphs.length === 1 ? run.glyphs[0] : undefined;
      const b = gl && gl.id !== 0 ? gl.bbox : undefined;
      const upm = font.unitsPerEm;
      if (b && Number.isFinite(b.minX) && b.maxX > b.minX && b.maxY > b.minY) {
        if (!upright) {
          // 全角の送りの字形だけ (プロポーショナルの字形は、詰める・空けるの対象でない。CSS Text 4 §8.5.1)
          if (Math.abs(gl!.advanceWidth - upm) <= upm * 0.01) hit = [b.minX / upm, b.maxX / upm];
        } else {
          const top = font.baselineRatio * upm;
          hit = [(top - b.maxY) / upm, (top - b.minY) / upm];
        }
      }
    } catch {
      hit = null;
    }
    memo.set(key, hit);
  }
  return hit ?? undefined;
}

/**
 * 約物の詰めの字の種類: 始め括弧類 (前に二分のアキ)・終わり括弧類と句読点 (後ろに二分のアキ)・中点類 (前後に四分のアキ)・どれでもない。
 * 句読点 (、。，．) とコロン類 (：；) は、字形の墨が字の枠のどこにあるかで決める (CSS Text 4 §8.5.3: 中央にあれば中点類、
 * 片側に寄っていて残りの半分が空いていれば終わり括弧類として詰める。UA は書体の情報で決めてよい)。
 *  - 句読点: 日本語・簡体字の書体は枠の前半 (横書きは左下、縦書きは右上) にあり、終わり括弧類と同じに詰める。繁体字の書体は枠の中央にあり、
 *    後ろの二分を詰めると次の字と重なるので、中点類として扱う (clreq §5.1・§6.3.2.1: 台湾・香港の句読点は字の枠の中央)
 *  - コロン類: 日本語・繁体字の書体は枠の中央 (中点類)。簡体字の書体は枠の前半にあり、終わり括弧類として扱う
 *  - 墨が枠の前半にも中央にも収まらない字形 (簡体字の書体の縦書きのコロンなど。clreq §6.3.2.1 の「固定」の約物) は、詰めない (字形が欠ける・重なる
 *    詰めはしなくてよい。CSS Text 4 §8.5.1)
 * 字形の分からない字 (書体を引いていない atom・全角でない字形) は、字で決まる既定 (日本語の約物の種類。jis.ts) のまま
 */
type PunctKind = 'open' | 'close' | 'middle' | 'none';
function punctKind(a: Atom, ch: string): PunctKind {
  if (isOpeningPunct(ch)) return 'open';
  const dflt: PunctKind = isClosingPunct(ch) ? 'close' : isMiddlePunct(ch) ? 'middle' : 'none';
  const dot = DOT_PUNCT.has(ch);
  if ((!dot && !COLON_PUNCT.has(ch)) || a.kind !== 'glyph' || !a.g || a.g.ch !== ch) return dflt;
  const span = inkSpan(a.g);
  if (!span) return dflt;
  const [s, e] = span;
  if (e <= 0.5 + INK_HALF_TOLERANCE) return 'close';
  if (s >= INK_MIDDLE_MARGIN && e <= 1 - INK_MIDDLE_MARGIN) return 'middle';
  return 'none';
}
/** 終わり括弧類・句読点として詰める字か (後ろの二分のアキ) */
const closingAt = (a: Atom, ch: string) => punctKind(a, ch) === 'close';
/** 中点類として詰める字か (前後の四分のアキ) */
const middleAt = (a: Atom, ch: string) => punctKind(a, ch) === 'middle';

/** 全角形 (U+FF01〜FF5E: ASCII の全角の英数字・記号・約物) */
function isFullwidthForm(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0xff01 && cp <= 0xff5e;
}

/** 約物でない字 (空白・枠の端は除く) */
function isPlainChar(a: Atom, ch: string): boolean {
  if (a.kind !== 'glyph' || a.isSpace || a.frameOpen || a.frameClose) return false;
  return !!ch && !isClosingPunct(ch) && !isOpeningPunct(ch) && !isMiddlePunct(ch);
}

/** ルビが掛けられる字 (仮名と約物。漢字・欧文には掛けない) */
const HANGUL = /^\p{Script=Hangul}$/u;
/**
 * ハングルとハングルの間の空白 (U+0020) の送りを、書体が文脈で決める幅にする (Measurer.contextSpaceDelta)。
 * ハングルの書体は、ハングルの語の間の空白を広い字形に置き換える (OpenType の calt)。空白は描かないので、送りだけを合わせる。
 * 字の単位 (書記素クラスタ) の atom は、基底の字 (first・last) で引く
 */
export function adjustHangulWordSpaces(atoms: Atom[], delta: (prev: string, next: string, st: ResolvedStyle) => number) {
  for (let k = 1; k + 1 < atoms.length; k++) {
    const a = atoms[k];
    if (a.kind !== 'glyph' || !a.isSpace || a.first !== ' ' || a.cluster) continue;
    const p = atoms[k - 1];
    const n = atoms[k + 1];
    if (p.kind !== 'glyph' || n.kind !== 'glyph' || !HANGUL.test(p.last) || !HANGUL.test(n.first)) continue;
    if (p.st.fontFamily !== a.st.fontFamily || n.st.fontFamily !== a.st.fontFamily || p.st.fontWeight !== a.st.fontWeight || n.st.fontWeight !== a.st.fontWeight || p.st.fontSize !== a.st.fontSize || n.st.fontSize !== a.st.fontSize) continue;
    a.advance += delta(p.last, n.first, a.st) * a.st.fontSize;
  }
}

function overhangable(a: Atom | undefined, ch: string | undefined): boolean {
  if (!a || a.kind !== 'glyph' || a.isSpace || a.frameOpen || a.frameClose || !ch) return false;
  return /[\u3041-\u309F\u30A1-\u30FA\u30FD-\u30FF]/u.test(ch) || isClosingPunct(ch) || isOpeningPunct(ch) || isMiddlePunct(ch);
}

/**
 * タイ文字の字 (U+0E01〜U+0E5B)。タイ文字の書体は、前に置く母音 (เ แ โ ใ ไ) と子音の間などを詰める組 (kern) を持つ。
 * 字の単位 (子音 + 上下の記号) の間の詰めは、基底の字の組で引く (書体の組の表は、記号を飛ばして引く指定)
 */
function isThaiLetter(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x0e01 && cp <= 0x0e5b;
}

/** 横書きでカーニングを掛ける字 (ASCII の英数字・記号と、ラテン文字の拡張、ギリシャ文字・キリル文字) */
function isLatinAlnumOrPunct(ch: string): boolean {
  // 一般句読点 (U+2010〜U+2027・U+2030〜U+205E。引用符 ‘’“”・ダッシュ・…) も含める (欧文の書体の kern の組に入っている。
  // element’s・‘a・r’ などの組を書体の kern の値で詰める)。
  // ギリシャ文字 (U+0370〜03FF・U+1F00〜1FFF)・キリル文字 (U+0400〜052F)・Latin Extended Additional (U+1E00〜1EFF。ベトナム語など) も、
  // 書体の kern の組で詰める (CSS Fonts 4 §6.3: font-kerning の初期値 auto。ГА・Те・Αυ などの組)
  return /^[\u0021-\u007E\u00C0-\u024F\u0370-\u052F\u1E00-\u1FFF\u2010-\u2027\u2030-\u205E]$/u.test(ch);
}

function rubyOverhang(a: Atom, prev: Atom | undefined, next: Atom | undefined) {
  const r = a.r!;
  // 下側のルビ (ruby-position: under・2 段目) も、親文字より長ければ掛ける
  const excess = Math.max(r.rubyAdvance, r.underAdvance ?? 0) - r.baseAdvance;
  if (excess <= EPS) return;
  const lim = Math.min(excess / 2, r.rubySize);
  const ovL = overhangable(prev, prev?.last) ? Math.min(lim, prev!.advance / 2) : 0;
  const ovR = overhangable(next, next?.first) ? Math.min(lim, next!.advance / 2) : 0;
  if (ovL + ovR <= EPS) return;
  a.ovL = ovL;
  a.ovR = ovR;
  a.advance -= ovL + ovR;
}

/** 行頭の全角の始め括弧類の前の二分アキを詰める量 (punctuationTrimStart。全角の字面のときだけ) */
function startTrimOf(a: Atom | undefined): number {
  if (!a || a.kind !== 'glyph') return 0;
  // hanging-punctuation: first (CSS Text 3 §8.2.1): 要素の 1 行目の行頭の始め括弧類・引用符 (Ps・Pi・Pf と ' ")・全角空白は、
  // 字全体を行の外へぶら下げる (字下げがあれば、その中に置く)
  if (a.paraStart && a.st.hangFirst && /^[\p{Ps}\p{Pi}\p{Pf}'"\u3000]$/u.test(a.first)) return a.advance;
  if (!isOpeningPunct(a.first)) return 0;
  // axf:punctuation-trim="start-except-first": 段落の 1 行目と、強制改行の直後の行の先頭は詰めない
  if (a.st.punctuationTrimStartExceptFirst && (a.paraStart || a.afterBreak)) return 0;
  // axf:punctuation-trim="start" などの指定か、段落の 1 行目の先頭 (互換モードの既定。段落の途中で折り返した行の先頭は詰めない)
  if (!a.st.punctuationTrimStart && !(a.paraStart && a.st.punctuationTrimParagraphStart)) return 0;
  const fs = a.st.fontSize;
  return a.advance > fs * 0.9 ? fs / 2 : 0;
}

/** 行末の全角の終わり括弧類・句読点の後ろのアキを捨てる量 (punctuationTrimEnd。字面の外に残っているアキの分、最大で二分) */
function endTrimOf(a: Atom | undefined): number {
  if (!a || a.kind !== 'glyph' || !a.st.punctuationTrimEnd || !closingAt(a, a.last)) return 0;
  // axf:punctuation-trim="end-except-fullstop": 句点 (。．) は除く
  if (a.st.punctuationTrimEndExceptFullstop && isFullStop(a.last)) return 0;
  const fs = a.st.fontSize;
  return a.advance > fs / 2 + EPS ? Math.min(fs / 2, a.advance - fs / 2) : 0;
}

export function breakOne(atoms: Atom[], start: number, L: number, indent: number, hangingDefault: boolean): { line: RawLine; next: number } {
  const n = atoms.length;
  const avail = Math.max(L - indent, 0);
  // 強制改行の直後の行の先頭の字に印を付ける (afterForcedBreak が飛ばす空白の手前に、改行がある)
  if (start > 0 && atoms[start]) {
    let p = start - 1;
    while (p >= 0 && atoms[p].kind === 'glyph' && atoms[p].isSpace && atoms[p].st.collapseSpaces) p--;
    if (p >= 0 && atoms[p].kind === 'break') atoms[start].afterBreak = true;
  }
  // 残す空白 (pre・pre-wrap・white-space-collapse="false") で始まる行: その空白 (字下げ) と続く語の間では折り返さない
  // (空白だけの行を作らない。コードの表示の字下げ)
  let lead = start;
  while (lead < n && atoms[lead].kind === 'glyph' && atoms[lead].isSpace && atoms[lead].st.collapseSpaces === false) lead++;
  if (lead >= n || atoms[lead].kind === 'break') lead = start;
  // 行頭のルビは前の字に掛けられないので、はみ出し分を戻して測る。行末になりうるルビも、後ろ側を戻して測る。
  // 行頭の始め括弧類の前のアキを詰めるなら、その分を差し引いて測る
  // 行頭の字の前の letter-spacing (XSL) も捨てる
  let x = (atoms[start]?.ovL ?? 0) - startTrimOf(atoms[start]) - (atoms[start]?.lsLead ?? 0);
  let k = start;
  while (k < n && atoms[k].kind !== 'break') {
    const w = atoms[k].advance;
    // 和欧間アキ・字の後ろの letter-spacing は行末なら捨てるので、それを除いて収まれば行に入れる
    // 行末の終わり括弧類・句読点の後ろのアキも、行末なら捨てる
    if (x + w - (atoms[k].trail ?? 0) - (atoms[k].lsTrail ?? 0) - endTrimOf(atoms[k]) + (atoms[k].ovR ?? 0) > avail + FIT_EPS && k > start) {
      if (!atoms[k].st.noWrap) break;
      // 折り返さない (nowrap・pre) 字があふれる: その前の、折り返してよい位置 (white-space が折り返す側の空白・和文の字の間など。
      // 両側が折り返さない字の間は除く) まで戻って改行する (Text 3 §3・§5)。無ければ、折り返さずにはみ出す
      let q = k - 1;
      while (q > lead && !(atoms[q].isSpace && !atoms[q].st.noWrap && !atoms[q].glue) && !(!(atoms[q].st.noWrap && atoms[q - 1].st.noWrap) && canBreakAtoms(atoms[q - 1], atoms[q]))) q--;
      if (q > lead) {
        let j = q;
        while (j < n && atoms[j].isSpace) j++;
        return { line: makeLine(atoms.slice(start, q), false, indent), next: j };
      }
    }
    x += w;
    k++;
  }
  if (k >= n) return { line: makeLine(atoms.slice(start, n), true, indent), next: n };
  if (atoms[k].kind === 'break') {
    const line = makeLine(atoms.slice(start, k), true, indent);
    if (line.items.length === 0) line.metric = atoms[k];
    // 強制改行の後の行頭の、詰める空白 (white-space: normal など) は取り除く (CSS Text 3 §4.1.2。「<br> 文字」の空白)
    return { line, next: afterForcedBreak(atoms, k) };
  }
  // atoms[k] が溢れる。atoms[start..k) は収まっている。
  const cand = atoms[k];
  // スペースは行末にぶら下げて吸収し、続くスペースも読み飛ばす。ただし、空白の後が前で改行しない画像 (互換モードのセルの最小の幅を
  // 測るときの img。Quirks Mode Standard §3.8) なら、空白で改行しない
  const afterSpaces = (() => {
    let j = k;
    while (j < n && atoms[j].isSpace) j++;
    return j;
  })();
  // つなぐ空白 (glue。keep-together の inline の中の語間など) では分けない
  if (cand.isSpace && !cand.glue && !(atoms[afterSpaces]?.noWrapInCellMin && atoms[afterSpaces].lbBefore === false)) return { line: makeLine(atoms.slice(start, k), false, indent), next: afterSpaces };
  // 欧文の語が僅かに溢れるときは、行の中の語間を詰めて語を行に収める (詰める順の最初の段階。JLREQ §3.8.3)
  const pushed = pushBySpaces(atoms, start, k, x, avail);
  if (pushed !== undefined) {
    let j = pushed;
    while (j < n && atoms[j].isSpace) j++;
    return { line: makeLine(atoms.slice(start, pushed), j >= n, indent), next: j };
  }
  if (
    cand.kind === 'glyph' &&
    isHangable(cand.first) &&
    cand.st.hanging &&
    hangingDefault &&
    k > start &&
    // 前の字の後ろの letter-spacing まで行に収まるときだけ (字間を空けた行では、約物が版面の外へ大きくはみ出すので、ぶら下げずに追い出す)
    x <= avail + FIT_EPS &&
    (k + 1 >= n || atoms[k + 1].kind === 'break' || canBreakAtoms(cand, atoms[k + 1]))
  ) {
    // ぶら下げ組み: 行末の 、。 を版面外へ出して配置
    const ln = makeLine(atoms.slice(start, k), false, indent);
    ln.hang = cand;
    return { line: ln, next: k + 1 };
  }
  // 追込み (JLREQ §3.8.2: 詰める処理を空ける処理より優先する): 次の分割点までを、詰めてよい箇所 (§3.8.3 の順と限界) を詰めて
  // 行に収められるなら収める。収まらなければ追い出す
  {
    let x2 = x;
    for (let e = k; e < Math.min(n, k + 40); e++) {
      const a = atoms[e];
      if (a.kind === 'break' || a.kind === 'leader') break;
      x2 += a.advance;
      const end = e + 1;
      if (end < n && atoms[end].kind !== 'break' && !(atoms[end].isSpace && !atoms[end].glue) && !canBreakAtoms(a, atoms[end])) continue;
      const items = atoms.slice(start, end);
      // 行末で捨てるアキ (和欧間・letter-spacing・行末の約物の後ろ) を除いた長さ
      const w = x2 - (a.trail ?? 0) - (a.lsTrail ?? 0) - endTrimOf(a) + (a.ovR ?? 0);
      if (w - lineSqueezable(items) <= avail + FIT_EPS) {
        let j2 = end;
        if (j2 < n && atoms[j2].kind === 'break') return { line: makeLine(items, true, indent), next: afterForcedBreak(atoms, j2) };
        while (j2 < n && atoms[j2].isSpace) j2++;
        return { line: makeLine(items, j2 >= n, indent), next: j2 };
      }
      break;
    }
  }
  // 追い出し: 禁則に抵触しない最も後ろの分割点まで戻る
  let j = k;
  while (j > lead && !canBreakAtoms(atoms[j - 1], atoms[j])) j--;
  // 分綴: 戻った分割点より後ろに、ハイフンを付けて収まる分綴の位置があれば、そこで分ける
  {
    let xj = x;
    for (let h = k; h > Math.max(j, start); h--) {
      if (h < k) xj -= atoms[h].advance;
      const hy = atoms[h - 1].hyphen;
      // xj = atoms[start..h) の長さ
      if (hy && h < n && xj + hy.advance <= avail + FIT_EPS && h - 1 > start) {
        const line = makeLine(atoms.slice(start, h), false, indent);
        line.items.push(hy);
        return { line, next: h };
      }
    }
  }
  if (j <= lead) {
    // 戻れない (行頭に置けない約物などが長く続く): 先の分割点までを、行内の約物のアキを詰めて押し込めるなら押し込む (追い込み)。
    // 詰めきれなければ、違反を承知で強制分割する
    let x2 = x;
    for (let j2 = k; j2 < Math.min(n, k + 12); j2++) {
      if (atoms[j2].kind === 'break') break;
      x2 += atoms[j2].advance;
      const end = j2 + 1;
      if (end < n && atoms[end].kind !== 'break' && !canBreakAtoms(atoms[j2], atoms[end])) continue;
      const items = atoms.slice(start, end);
      if (x2 - lineSqueezable(items) <= avail + FIT_EPS) return { line: makeLine(items, end >= n, indent), next: end };
      break;
    }
    // 控えた斜線の後ろの改行の機会 (lbSoft): ほかに改行できる位置が無ければ使う (表の列の最小の幅の「PDF/A-1a」など)
    for (let q = k; q > lead; q--) if (atoms[q].lbSoft) return { line: makeLine(atoms.slice(start, q), false, indent), next: q };
    // CSS の overflow-wrap: normal: 語の途中では分けず、次の分割点まではみ出す (Text 3 §5.5)
    if (cand.st.overflowWrap === 'normal' || (cand.st.overflowWrap === 'break-word' && cand.intrinsic)) {
      // はみ出すときも、控えた斜線の後ろ (lbSoft) が先にあれば、そこまでにする
      let e = k + 1;
      while (e < n && atoms[e].kind !== 'break' && !canBreakAtoms(atoms[e - 1], atoms[e]) && !atoms[e].lbSoft) e++;
      let j2 = e;
      while (j2 < n && atoms[j2].isSpace) j2++;
      if (j2 < n && atoms[j2].kind === 'break') return { line: makeLine(atoms.slice(start, e), true, indent), next: afterForcedBreak(atoms, j2) };
      return { line: makeLine(atoms.slice(start, e), j2 >= n, indent), next: j2 };
    }
    j = k;
    // 語の途中で分けるときも、字の単位 (書記素クラスタ) の途中では分けない (overflow-wrap が分けるのは字の単位の間。Text 3 §5.5)。
    // 字ごとに分けて組んだクラスタの途中なら、クラスタの始めまで戻る (戻れなければ、クラスタの終わりまで進む)
    while (j > lead && atoms[j].clusterCont) j--;
    if (j <= lead) for (j = k; j < n && atoms[j].clusterCont; ) j++;
  }
  return { line: makeLine(atoms.slice(start, j), false, indent), next: j };
}

/**
 * 分綴の位置に印を付ける: hyphenate を指定した欧文の語 (字の連なり) ごとに、hyphenate(語, 言語) が返す位置の字へ、
 * 行末に付けるハイフンの atom を持たせる
 */
export function markHyphenation(atoms: Atom[], hyphenate: (word: string, lang: string | undefined) => number[] | undefined, m: Measurer, wm: WritingMode) {
  // 合字の字 (U+FB00〜U+FB04、または liga でまとめた字の並び) は、元の字の並びとして語に数える
  const LIG: Record<string, string> = { '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl' };
  const textOf = (a: Atom) => (a.g?.draw && a.g.draw.length > 1 ? a.g.draw : (LIG[a.first] ?? a.first));
  // 語の字: ラテン文字。ウクライナ語の文ではキリル文字、現代ギリシャ語の文ではギリシャ文字も (その言語の規則があるときだけ。
  // CSS Text 3 §5.3: 自動の分綴は、文の言語が分かり、その言語に合う分綴の資源があるときだけ行う)
  const isLetter = (a: Atom | undefined) => {
    if (!a || a.kind !== 'glyph' || !a.g || a.st.hyphenate !== true) return false;
    const t = textOf(a);
    return /^[A-Za-zÀ-ɏ]+$/u.test(t) || !!hyphenationLetters(a.st.language)?.test(t);
  };
  for (let i = 0; i < atoms.length; ) {
    if (!isLetter(atoms[i])) {
      i++;
      continue;
    }
    let e = i;
    // 語は字の連なりで決める (inline の境目では切らない。CSS Text 3 §5.3)。言語が変わるところまで
    while (e < atoms.length && isLetter(atoms[e]) && atoms[e].st.language === atoms[i].st.language) e++;
    // 語の前後が字・数字に続く (語の途中の一部) なら分けない
    const word = atoms.slice(i, e);
    // ソフトハイフンを含む語は、自動の分綴をしない (CSS Text 3 §5.3)
    if (word.some((a) => a.softHyphen)) {
      i = e;
      continue;
    }
    // 字の数と位置は、分綴の規則 (hyphenPositions) と同じくコードポイントで数える (UTF-16 の長さではない)
    const cpLen = (t: string) => [...t].length;
    if (word.reduce((n, a) => n + cpLen(textOf(a)), 0) >= 5) {
      const st = word[0].st;
      const texts = word.map(textOf);
      const pos = hyphenate(texts.join(''), st.language) ?? [];
      if (pos.length) {
        const g = m.glyph('-', { fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontSize: st.fontSize, stretch: st.fontStretch }, wm);
        // 字の位置 → その字で終わる atom (合字の途中の位置では分けない)
        const endAt = new Map<number, number>();
        let c = 0;
        texts.forEach((t, k) => endAt.set((c += cpLen(t)) - 1, k));
        for (const p of pos) {
          const k = endAt.get(p);
          const a = k === undefined ? undefined : word[k];
          if (a && k! < word.length - 1) a.hyphen = { kind: 'glyph', first: '-', last: '-', advance: g.advance, isSpace: false, runId: a.runId, st, bg: a.bg, g };
        }
      }
    }
    i = e;
  }
}

/** atoms[k] から次の分割点までを、行の中の語間 (空白) を詰めて収められれば、その分割点を返す (和欧間のアキは詰めない) */
function pushBySpaces(atoms: Atom[], start: number, k: number, x: number, avail: number): number | undefined {
  let room = 0;
  for (let i = start; i < k; i++) room += wordSpaceSqueeze(atoms[i]);
  if (room <= EPS) return undefined;
  let x2 = x;
  for (let j = k; j < Math.min(atoms.length, k + 40); j++) {
    const a = atoms[j];
    if (a.kind === 'break' || (a.isSpace && !a.glue)) return x2 - room <= avail + FIT_EPS ? j : undefined;
    x2 += a.advance;
    if (x2 - room > avail + FIT_EPS) return undefined;
    if (j + 1 >= atoms.length) return j + 1;
    if (canBreakAtoms(a, atoms[j + 1])) return j + 1;
  }
  return undefined;
}

/** 欧文の語間で詰めてよい量: 空白の字そのものの幅の 1/3 (letter-spacing の分は詰めない) */
function wordSpaceSqueeze(a: Atom): number {
  // 残す空白 (pre・pre-wrap・white-space-collapse="false") は詰めない (コードの表示の字下げが縮まない)
  if (a.kind !== 'glyph' || a.first !== ' ' || a.st.wordSpaceShrink === false || a.st.collapseSpaces === false) return 0;
  return Math.max(a.advance - (a.lsLead ?? 0) - (a.lsTrail ?? 0), 0) / 3;
}

/** 全角の約物の字面の外のアキ (終わり括弧類・句読点は後ろの二分、始め括弧類は前の二分、中点類は前後の四分ずつ)。axf:punctuation-spacing で狭めたものは残っている分だけ */
function punctAki(a: Atom): number {
  const fs = a.st.fontSize;
  return a.advance > fs / 2 + EPS ? Math.min(fs / 2, a.advance - fs / 2) : 0;
}

/**
 * 追込み (行の調整処理で詰める処理) で、atom を詰めてよい量を、詰める順の段階ごとに返す (JLREQ §3.8.3「詰める処理の優先順位」)。
 *  0. 欧文間隔 (語間)
 *  1. 行末の終わり括弧類・読点類・句点類の後ろの二分アキ (ベタ組まで)
 *  2. 行末の中点類の前後の四分アキ (ベタ組まで)
 *  3. 行中の中点類の前後の四分アキ (ベタ組まで)
 *  4. 行中の始め括弧類の前、終わり括弧類・読点類の後ろの二分アキ (ベタ組まで)。行中の句点類の後ろは詰めない
 *  5. 和字と欧字・数字の間の四分アキ (八分アキまで)
 * 語間の限界は、欧文の行の調整と同じ空白の 1/3 のまま (JLREQ の「最小で四分アキまで」は、和文に混ぜた欧文の語間の目安)。
 * tail は行末の atom、head は行頭の atom (行頭の始め括弧類の前のアキは「行中」ではないので詰めない。捨てるかどうかは startTrimOf)。
 * 行末で捨てたアキ (endTrimOf・和欧間・letter-spacing) は、もう詰められないので数えない
 */
const SQUEEZE_LEVELS = 6;
function squeezeParts(a: Atom, tail: boolean, head: boolean): number[] {
  const out = new Array<number>(SQUEEZE_LEVELS).fill(0);
  if (a.kind !== 'glyph') return out;
  out[0] = wordSpaceSqueeze(a);
  const fs = a.st.fontSize;
  if (closingAt(a, a.last)) {
    const aki = punctAki(a);
    if (tail) out[1] = Math.max(aki - endTrimOf(a), 0);
    else if (!isFullStop(a.last)) out[4] = aki;
  } else if (isOpeningPunct(a.first)) out[4] = head ? 0 : punctAki(a);
  else if (middleAt(a, a.first)) out[tail ? 2 : 3] = punctAki(a);
  if (a.trail && !tail) out[5] = Math.max(a.trail - fs / 8, 0);
  return out;
}

/** 句点類 (行中では後ろのアキを詰めない) */
function isFullStop(ch: string): boolean {
  return ch === '。' || ch === '．';
}

/** 追込みで、行 (items) の中で詰めてよい量の合計 (squeezeCap まで) */
function lineSqueezable(items: Atom[]): number {
  let t = 0;
  items.forEach((a, k) => {
    for (const v of squeezeParts(a, k === items.length - 1, k === 0)) t += v;
  });
  return Math.min(t, squeezeCap(items));
}
/**
 * 1 行の中で追込みで詰めてよい量 (語間・約物のアキ・和欧間のアキのすべて) の合計の上限。
 * lineSqueezeMax (字の大きさに対する比) が無ければ無制限 (JLREQ §3.8.3 は量を限らない)。
 * アンテナハウス互換は 0.5 (二分 = 約物 1 つ分): 読点 2 つを詰めれば入る 1 字や、和欧間のアキを何か所も
 * 少しずつ詰めれば入る 1 字は追い込まず次の行へ送り、読点 1 つで足りる分は追い込む
 */
function squeezeCap(items: Atom[]): number {
  const g = items.find((a) => a.kind === 'glyph');
  const r = g?.st.lineSqueezeMax;
  return g && r !== undefined ? r * g.st.fontSize : Infinity;
}

/**
 * 行の字下げの量 (CSS Text 3 §8.1)。ふだんは要素の最初の行 (first) だけを字下げする。
 * each-line なら強制改行の後の行 (afterForced) も最初の行と同じに扱い、hanging なら字下げを掛ける行を逆にする
 */
export function lineIndent(st: { textIndent: number; textIndentHanging?: boolean; textIndentEachLine?: boolean }, first: boolean, afterForced: boolean): number {
  const head = first || (!!st.textIndentEachLine && afterForced);
  return head !== !!st.textIndentHanging ? st.textIndent : 0;
}

/**
 * 行に切り分ける。firstIndent は 1 行目の字下げ。st を渡すと、行ごとの字下げを lineIndent で決める
 * (first: この並びの 1 行目が要素の最初の行か)
 */
export function breakLines(atoms: Atom[], L: number, firstIndent: number, hangingDefault: boolean, indentOf?: { st: Parameters<typeof lineIndent>[0]; first: boolean }): RawLine[] {
  const lines: RawLine[] = [];
  let start = 0;
  let first = true;
  let afterForced = false;
  if (atoms[0]) atoms[0].paraStart = true;
  while (start < atoms.length) {
    // 行頭の控えめな改行 (soft。行内の要素のブロックの ::before / ::after): 空の行を作らない
    if (atoms[start].kind === 'break' && atoms[start].soft) {
      start = afterForcedBreak(atoms, start);
      continue;
    }
    const indent = indentOf ? lineIndent(indentOf.st, first && indentOf.first, afterForced) : first ? firstIndent : 0;
    const { line, next } = breakOne(atoms, start, L, indent, hangingDefault);
    first = false;
    // 強制改行で終わった行 (段落の最後の行は次が無いので問わない)
    afterForced = line.last;
    lines.push(line);
    start = next;
  }
  return lines;
}

// ───────────────────────── 行内配置 ─────────────────────────

export interface PositionedLine {
  raw: RawLine;
  offsets: number[];
  /** 各 atom の実際の送り長さ (leader は行の余白を吸収して伸縮する) */
  widths: number[];
  hangOffset?: number;
  contentLength: number;
  /** ルビの atom ごとの、実際に前後の字へ掛けた長さ [前, 後ろ] */
  overhang?: Array<number[] | undefined>;
  /** 右から左へ並べた行 (mirrorLine 済み) */
  rtl?: boolean;
  /** 追い込みで字面をずらす量 (始め括弧類を前へ) */
  shrinkDx?: number[];
}

/** 右から左の字・双方向の制御を含みうる字 (これが無い左から右の段落は、並べ替えない) */
const MAYBE_BIDI = /[\u0590-\u08FF\u200F\u202A-\u202E\u2066-\u2069\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/**
 * 段落の atom に、双方向の埋め込みの深さを付ける (UAX #9 の段落の処理。段落の向きは direction)。
 * 字の atom は先頭の字の性質、空白はその字、箱・ルビ・縦中横・リーダーは U+FFFC (ON)、強制改行は U+2028 (WS) として扱う。
 * 右から左の深さの、鏡像のある字 (括弧など) は鏡像の字にする (L4)。
 * 左から右の段落で右から左の字が無ければ、何もしない (false)
 */
export function markBidi(atoms: Atom[], rtl: boolean, m: Measurer, wm: WritingMode, unicodeBidi?: Atom['st']['unicodeBidi']): boolean {
  const override = unicodeBidi === 'bidi-override' || unicodeBidi === 'isolate-override';
  const plaintext = unicodeBidi === 'plaintext';
  if (!rtl && !override && !plaintext && !atoms.some((a) => a.bidiOpen || (a.kind === 'glyph' && MAYBE_BIDI.test(a.first)))) return false;
  // 字の並び: atom ごとに、前の制御文字・字 (先頭の字)・後ろの制御文字。block の上書きは、全体を LRO/RLO … PDF で囲む
  const cps: number[] = [];
  const at: number[] = [];
  if (override) cps.push(rtl ? 0x202e : 0x202d);
  for (const a of atoms) {
    if (a.bidiOpen) cps.push(...a.bidiOpen);
    at.push(cps.length);
    cps.push(a.kind === 'glyph' ? (a.first.codePointAt(0) ?? 0xfffc) : a.kind === 'break' ? 0x2028 : 0xfffc);
    if (a.bidiClose) cps.push(...a.bidiClose);
  }
  if (override) cps.push(0x202c);
  // plaintext の段落の向きは、最初の強い字で決める (P2・P3。Writing Modes 3 §2.2)
  const p = resolveLevels(cps, plaintext ? 'auto' : rtl ? 'rtl' : 'ltr');
  atoms.forEach((a, k0) => {
    const k = at[k0];
    a.bidiLevel = p.levels[k];
    a.bidiPara = p.level;
    const c = p.types[k];
    if (c === 'S' || c === 'B') a.bidiReset = 2;
    else if (c === 'WS' || c === 'LRI' || c === 'RLI' || c === 'FSI' || c === 'PDI' || c === 'BN' || c === 'LRE' || c === 'RLE' || c === 'LRO' || c === 'RLO' || c === 'PDF') a.bidiReset = 1;
    // L4: 右から左の深さでは、鏡像の字の形を使う
    if (a.kind === 'glyph' && p.levels[k] % 2 && a.g && [...a.first].length === 1) {
      const mc = mirrorChar(cps[k]);
      if (mc !== undefined) {
        const ch = String.fromCodePoint(mc);
        const st = a.st;
        const rs = { fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontSize: st.fontSize, stretch: st.fontStretch, features: st.fontFeatures, orientation: st.textOrientation };
        // 字の単位 (基底の字 + 結合文字) は、基底の字だけを鏡像の字に替える (結合文字は残す)
        if (a.cluster) a.cluster = ch + a.cluster.slice(a.first.length);
        const g = a.cluster ? m.clusterGlyph(a.cluster, rs, wm) : m.glyph(ch, rs, wm);
        // 字間・語間 (letter-spacing・word-spacing) は元の字の送りに足してあるので、鏡像の字にも同じだけ足す (送りの差は字形の分だけ)
        const spacing = a.g.spacing ?? 0;
        if (spacing) {
          g.advance += spacing;
          g.spacing = spacing;
        }
        a.advance += g.advance - a.g.advance;
        a.g = g;
        a.first = ch;
        a.last = ch;
      }
    }
  });
  return true;
}

/**
 * 行の字を、双方向の深さ (markBidi) に従って左から右へ並べ直す (UAX #9 の L1・L2)。
 * 右から左の段落 (rtl) は、左から右で求めた位置を行の幅 L の中で左右反転してから並べる。
 * 並べ直しでは、論理の順で隣り合う字の間の空き (両端揃えの空きなど) を、そのまま保つ
 */
export function reorderLine(pl: PositionedLine, L: number, rtl: boolean, paraLevel?: number) {
  const items = pl.raw.items;
  const n = items.length;
  if (!rtl && !items.some((a) => (a.bidiLevel ?? 0) > 0)) return;
  // 段落の深さ (plaintext の段落は最初の強い字で決めたもの。並べる位置の反転は direction で決める)
  const para = paraLevel ?? items.find((a) => a.bidiPara !== undefined)?.bidiPara ?? (rtl ? 1 : 0);
  const o = pl.offsets;
  const w = pl.widths;
  // 字ごとの深さ (L1: 区切りの字・その前の空白・行末の空白は段落の深さ)。深さの無い atom (分綴のハイフンなど) は前の字の深さ
  const lv: number[] = new Array(n);
  for (let k = 0; k < n; k++) lv[k] = items[k].bidiLevel ?? (k > 0 ? lv[k - 1] : para);
  let trailing = true;
  for (let k = n - 1; k >= 0; k--) {
    const r = items[k].bidiReset ?? (items[k].isSpace ? 1 : undefined);
    if (r === 2) {
      lv[k] = para;
      trailing = true;
    } else if (trailing && r === 1) lv[k] = para;
    else trailing = false;
  }
  const off = rtl ? o.map((x, k) => L - x - w[k]) : o.slice();
  let x = n ? Math.min(...off) : 0;
  const order = visualOrder(lv);
  // 並びが変わらない左から右の行は、位置もそのまま
  if (!rtl && order.every((v, k) => v === k)) return;
  // 論理の順で k と k + 1 の間の空き
  const gap = (k: number) => (k + 1 < n ? o[k + 1] - (o[k] + w[k]) : 0);
  for (let v = 0; v < n; v++) {
    const a = order[v];
    off[a] = x;
    const b = order[v + 1];
    x += w[a] + (b === undefined ? 0 : Math.abs(a - b) === 1 ? gap(Math.min(a, b)) : gap(a));
  }
  pl.offsets = off;
  if (rtl) {
    if (pl.hangOffset !== undefined && pl.raw.hang) pl.hangOffset = L - pl.hangOffset - pl.raw.hang.advance;
    pl.rtl = true;
  }
}

function stretchable(a: Atom, b: Atom): boolean {
  if (a.isSpace) return true;
  // 欧文どうしの間は、分割できても (ハイフン・スラッシュの後ろなど) 広げない。CSS Text 3 §7.1: 欧文の両端揃えで広げるのは
  // 語の区切り (空白) だけ。字間を広げるのは、和字 (漢字・仮名・ハングルと和文の約物) の前後
  if (!isCjkJustify(a.last) && !isCjkJustify(b.first)) return false;
  return canBreakAtoms(a, b);
}
/**
 * 空ける処理 (JLREQ §3.8.4 の優先順位): 行の余り free を、字間ごとに配る。
 *  a. 欧文間隔を、二分アキまで均等に空ける
 *  b. 和字と欧字・数字の間の四分アキ (和欧間) を、二分アキまで均等に空ける
 *  c. ほかの空けてよい字間 (分割してよい、和字の前後の字間) を、四分アキまで均等に空ける
 *  d. それでも余れば、a〜c の字間を均等に空ける
 * 「均等に」は文字サイズ比 (字の大きさに比例して配る)
 */
function expandGaps(items: Atom[], free: number): number[] {
  const n = items.length;
  const gaps = new Array<number>(n).fill(0);
  type Slot = { k: number; cap: number; level: 0 | 1 | 2; fs: number };
  const slots: Slot[] = [];
  for (let k = 0; k + 1 < n; k++) {
    const a = items[k];
    if (!stretchable(a, items[k + 1])) continue;
    const fs = a.st.fontSize;
    if (a.isSpace) slots.push({ k, level: 0, fs, cap: Math.max(fs / 2 - (a.advance - (a.lsLead ?? 0) - (a.lsTrail ?? 0)), 0) });
    else if (a.trail) slots.push({ k, level: 1, fs, cap: Math.max(fs / 2 - a.trail, 0) });
    else slots.push({ k, level: 2, fs, cap: fs / 4 });
  }
  let rest = free;
  for (const lv of [0, 1, 2] as const) {
    if (rest <= EPS) break;
    // 限界まで、字の大きさに比例して配る (限界に届いた字間を除いて、残りを配り直す)
    let active = slots.filter((s) => s.level === lv && s.cap > EPS);
    for (let pass = 0; pass < 8 && active.length && rest > EPS; pass++) {
      const sum = active.reduce((t, s) => t + s.fs, 0);
      const unit = rest / sum;
      const next: Slot[] = [];
      for (const s of active) {
        const room = s.cap - gaps[s.k];
        const add = Math.min(unit * s.fs, room);
        gaps[s.k] += add;
        rest -= add;
        if (room - add > EPS) next.push(s);
      }
      active = next;
    }
  }
  if (rest > EPS && slots.length) {
    const sum = slots.reduce((t, s) => t + s.fs, 0);
    for (const s of slots) gaps[s.k] += (rest * s.fs) / sum;
  }
  return gaps;
}

/** 字間で両端揃えする字 (漢字・仮名・ハングルと、和文の約物・全角形) */
function isCjkJustify(ch: string): boolean {
  return isCjkLetter(ch) || /[\u3000-\u303f\uff00-\uffef\u30fb\u2e80-\u2fff]/u.test(ch);
}
function isCjkLetter(ch: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch);
}

/** leader に余白 free を等分配する (各 leader の min/max でクランプし、残りを再配分) */
function fillLeaders(items: Atom[], widths: number[], free: number) {
  const idx = items.map((a, k) => (a.kind === 'leader' ? k : -1)).filter((k) => k >= 0);
  let remaining = free;
  let active = idx.slice();
  for (let pass = 0; pass < 4 && active.length && Math.abs(remaining) > EPS; pass++) {
    const share = remaining / active.length;
    const next: number[] = [];
    for (const k of active) {
      const ld = items[k].leader!;
      const want = widths[k] + share;
      const w = Math.min(Math.max(want, ld.min), ld.max);
      remaining -= w - widths[k];
      widths[k] = w;
      if (w > ld.min + EPS && w < ld.max - EPS) next.push(k);
    }
    active = next;
  }
}

export function positionLine(raw: RawLine, L: number, style: ResolvedStyle): PositionedLine {
  const items = raw.items;
  const avail = Math.max(L - raw.indent, 0);
  const widths = items.map((t) => t.advance);
  // 行頭・行末のルビは、行の外の字には掛けない (はみ出し分を送りへ戻す)
  const ov = items.map((t, k) => (t.ovL || t.ovR ? [k === 0 ? 0 : (t.ovL ?? 0), k === items.length - 1 ? 0 : (t.ovR ?? 0)] : undefined));
  ov.forEach((o, k) => {
    if (o) widths[k] += (items[k].ovL ?? 0) - o[0] + (items[k].ovR ?? 0) - o[1];
  });
  // 行末の字の後ろの和欧間アキは捨てる
  const tail = items.length - 1;
  if (tail >= 0 && items[tail].trail) widths[tail] -= items[tail].trail!;
  // letter-spacing の行頭・行末の分は捨てる (XSL §7.17.2: conditionality = discard)
  if (tail >= 0 && items[tail].lsTrail) widths[tail] -= items[tail].lsTrail!;
  // 行末の終わり括弧類・句読点の後ろのアキを捨てる (ぶら下げた行は、ぶら下げた字が行の外なので対象外)
  const endTrim = tail >= 0 && !raw.hang ? endTrimOf(items[tail]) : 0;
  if (endTrim) widths[tail] -= endTrim;
  const lsHead = items[0]?.lsLead ?? 0;
  if (lsHead) widths[0] -= lsHead;
  // 行頭の始め括弧類の前の二分アキを詰める (字面を前へ寄せる)
  const startTrim = startTrimOf(items[0]);
  if (startTrim) widths[0] -= startTrim;
  const hasLeader = items.some((t) => t.kind === 'leader');
  if (hasLeader) fillLeaders(items, widths, avail - widths.reduce((a, b) => a + b, 0));
  // 追込み: 行が溢れるときは、詰めてよい箇所を JLREQ §3.8.3 の順に、段階ごとに文字サイズ比で均等に詰める
  // (始め括弧類は字面を前へ寄せる)。ぶら下げた行は、ぶら下げた字が行の外なので、行末の約物として扱わない
  let shrinkDx: number[] | undefined;
  let over = widths.reduce((a, b) => a + b, 0) - avail;
  if (over > EPS) {
    const parts = items.map((a, k) => squeezeParts(a, k === tail && !raw.hang, k === 0));
    // 詰める量の合計は squeezeCap まで (アンテナハウス互換)
    let left = squeezeCap(items);
    for (let lv = 0; lv < SQUEEZE_LEVELS && over > EPS && left > EPS; lv++) {
      const total = parts.reduce((t, p) => t + p[lv], 0);
      if (total <= EPS) continue;
      const r = Math.min(1, over / total, left / total);
      left -= total * r;
      items.forEach((a, k) => {
        const c = parts[k][lv] * r;
        if (!c) return;
        widths[k] -= c;
        if (lv === 4 && isOpeningPunct(a.first)) (shrinkDx ??= items.map(() => 0))[k] -= c;
        // 中点類は前後の四分アキを同じだけ詰めるので、字面を詰めた量の半分だけ前へ寄せる (字面を詰めた幅の中央に置く)
        else if ((lv === 2 || lv === 3) && middleAt(a, a.first)) (shrinkDx ??= items.map(() => 0))[k] -= c / 2;
      });
      over -= total * r;
    }
  }
  const width = widths.reduce((a, b) => a + b, 0);
  const offsets: number[] = [];
  let startOff = raw.indent;
  let gap = 0;
  /** 字間ごとの空き (JLREQ §3.8.4 で配ったとき)。gaps[k] は items[k] と items[k + 1] の間 */
  let gaps: number[] | undefined;
  const free = avail - width;
  // leader を含む行は leader が余白を吸収するので均等割付しない
  // 最終行は textAlignLast があればそれに従う (無ければ通常行と同じ揃え。ただし両端揃えは行わない)
  const align = raw.last && style.textAlignLast ? style.textAlignLast : style.textAlign;
  if (align === 'justify' && (!raw.last || style.textAlignLast === 'justify') && free > EPS && !hasLeader && (!style.fixedLetterSpacing || (style.letterSpacingStretch ?? 0) > 0)) {
    let slots = 0;
    for (let k = 0; k + 1 < items.length; k++) if (stretchable(items[k], items[k + 1])) slots++;
    if (slots > 0) gap = style.fixedLetterSpacing ? Math.min(free / slots, style.letterSpacingStretch ?? 0) : free / slots;
    // 和字を含む行は、空ける処理の順と限界 (JLREQ §3.8.4) で字間ごとに空ける。欧文だけの行は、語間に等しく配る (CSS Text 3 §7.1)
    if (slots > 0 && !style.fixedLetterSpacing && items.some((a) => a.kind === 'glyph' && (isCjkJustify(a.first) || isCjkJustify(a.last)))) {
      gaps = expandGaps(items, free);
      gap = 0;
    }
  } else if (align === 'center' && (free > 0 || style.alignOverflow)) {
    // 収まらない中身は行の始めにそろえる (CSS Text 3 §6.1)
    startOff += free / 2;
  } else if (align === 'end' && (free > 0 || style.alignOverflow)) {
    startOff += free;
  }
  let x = startOff;
  for (let k = 0; k < items.length; k++) {
    offsets.push(x);
    x += widths[k];
    if (gap && k + 1 < items.length && stretchable(items[k], items[k + 1])) x += gap;
    if (gaps) x += gaps[k] ?? 0;
  }
  // 中身の長さ (中央・末尾揃えで寄せた分は含めない。inline-container の shrink-to-fit に使う)
  const out: PositionedLine = { raw, offsets, widths, contentLength: x - startOff };
  if (ov.some((o) => o)) out.overhang = ov;
  if (startTrim || lsHead) {
    shrinkDx ??= items.map(() => 0);
    shrinkDx[0] -= startTrim + lsHead;
  }
  if (shrinkDx?.some((d) => d)) out.shrinkDx = shrinkDx;
  // ぶら下げた字は、行の最後の字のすぐ後ろに置く (両端揃えの行では版面端ちょうど。揃えない行で版面端に置くと、最後の字との間が空く)
  if (raw.hang) out.hangOffset = x;
  return out;
}

// ───────────────────────── 行 → LNode ─────────────────────────

/** OpenType の機能による字の位置のずれ (書体の単位)。書体・字・機能の組ごとに覚える */
const featureOffsets = new WeakMap<GlyphMetrics['font'], Map<string, { x: number; y: number } | null>>();
function featureOffset(font: GlyphMetrics['font'], text: string, features: string[]): { x: number; y: number } | null {
  let byKey = featureOffsets.get(font);
  if (!byKey) featureOffsets.set(font, (byKey = new Map()));
  const key = text + '\u0000' + features.join(',');
  let v = byKey.get(key);
  if (v === undefined) {
    const p = font.fk.layout(text, Object.fromEntries(features.map((t) => [t, true])) as never).positions[0];
    v = p ? { x: p.xOffset, y: p.yOffset } : null;
    byKey.set(key, v);
  }
  return v;
}

export function glyphNode(
  g: GlyphMetrics,
  st: ResolvedStyle,
  wm: WritingMode,
  ch: string,
  fontSize: number,
  color: string,
  src?: string,
  cite?: string,
): LNode {
  const br = g.font.baselineRatio;
  let baselineX = 0;
  let baselineY = br * fontSize;
  let rotation: 0 | 90 = 0;
  let text = g.vertical?.glyph ?? g.draw ?? ch;
  if (wm !== 'horizontal-tb' && g.vertical) {
    const v = g.vertical;
    if (v.mode === 'rotate') {
      // 90° 時計回り: 字の上端が右を向く。em ボックスが [0, fs] に収まる原点
      rotation = 90;
      baselineX = (1 - br) * fontSize;
      // 送りに足した字間 (g.spacing) は字の後ろの空きなので、字を中央に寄せる分には数えない
      baselineY = (g.advance - (g.spacing ?? 0) - g.naturalWidth) / 2;
    } else {
      baselineX = (fontSize - g.naturalWidth) / 2 + v.dx * fontSize;
      baselineY = br * fontSize + v.dy * fontSize;
    }
  }
  // OpenType の機能による字の位置のずれ (palt など。送りは計測で済んでいる)。描く原点に入れる
  if (wm === 'horizontal-tb' && st.fontFeatures?.length) {
    const off = featureOffset(g.font, text, st.fontFeatures);
    if (off) {
      baselineX += (off.x * fontSize) / g.font.unitsPerEm;
      baselineY -= (off.y * fontSize) / g.font.unitsPerEm;
    }
  }
  // 省略できる値は、指定があるときだけ代入する (字ごとに小さなオブジェクトを作らない)
  const glyph: NonNullable<LNode['glyph']> = {
    text,
    fontFamily: g.font.family,
    fontWeight: g.font.weight,
    fontSize,
    color,
    baselineX,
    baselineY,
    rotation,
    scaleX: g.scaleX ?? 1,
    advance: g.advance,
  };
  if (st.italic) glyph.italic = true;
  if (st.fontWeight >= 600 && g.font.weight < 600) glyph.fakeBold = true;
  if (st.fontFeatures?.length && wm === 'horizontal-tb') glyph.features = st.fontFeatures;
  // 縦書き: 書体の縦書き用の字形 (vert) で描く
  else if (wm !== 'horizontal-tb' && g.vertical?.features) glyph.features = g.vertical.features;
  return newNode('glyph', wm, { isize: g.advance, bsize: fontSize, src, glyph, ...(cite ? { cite } : {}) });
}

/**
 * 親文字・ルビを均等割り (space-around) で配置する。
 * joined[k] が真なら、k 番目の字は前の字とひとまとまり (間を空けない)。まとまりを 1 つの単位として割る
 */
function distribute(advances: number[], total: number, joined?: boolean[]): number[] {
  const sum = advances.reduce((a, b) => a + b, 0);
  const n = advances.reduce((c, _a, k) => c + (k > 0 && joined?.[k] ? 0 : 1), 0);
  const gap = n > 0 ? (total - sum) / n : 0;
  const out: number[] = [];
  let x = gap / 2;
  advances.forEach((a, k) => {
    if (k > 0 && joined?.[k]) x -= gap;
    out.push(x);
    x += a + gap;
  });
  return out;
}

/** ルビの字の間を空けてよい字 (和文の字: 漢字・仮名。CSS Ruby 1 §4.3 の text-justify: ruby の「CJK の字」。注音字母・欧文は含めない) */
const isRubyJustifyChar = (ch: string): boolean => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30FC\u3005\u3007]/u.test(ch);

/**
 * 親文字・ルビの字を、長さ total の箱の中に置く位置 (CSS Ruby 1 §4.3 ruby-align)。
 *  - 指定が無ければ、これまでの配り方 (distribute: どの字にも、前後に同じアキを付ける)
 *  - start: 始めの端から詰めて置く。center: 中央に詰めて置く
 *  - space-between: 字の間 (和文の字どうしの間だけ。§4.3 の例: 欧文・注音字母の字の間は空けない) を均等に空ける。空ける所が無ければ中央
 *  - space-around: space-between の空ける所に、もう 1 つ分を足し、その半分ずつを前後に付ける
 * 中身が箱より長いとき (余りが無いとき) は、どの値でも詰めて置く
 */
function rubyOffsets(glyphs: GlyphMetrics[], total: number, align: RubyAlign | undefined): number[] {
  const advances = glyphs.map((g) => g.advance);
  if (!align) return distribute(advances, total);
  const extra = Math.max(total - advances.reduce((x, y) => x + y, 0), 0);
  const opp = glyphs.map((g, k) => k > 0 && isRubyJustifyChar(glyphs[k - 1].ch) && isRubyJustifyChar(g.ch));
  const n = opp.filter(Boolean).length;
  let gap = 0;
  let x = extra / 2;
  if (align === 'start') x = 0;
  else if (align === 'space-between' && n > 0) {
    gap = extra / n;
    x = 0;
  } else if (align === 'space-around') {
    gap = extra / (n + 1);
    x = gap / 2;
  }
  const out: number[] = [];
  advances.forEach((adv, k) => {
    if (opp[k]) x += gap;
    out.push(x);
    x += adv;
  });
  return out;
}

/**
 * leader の描画ノード。
 *   dots: 行頭 (= インライン座標 0) 基準で pitch の倍数位置に点を置く → 複数行で点が縦に揃う
 *   rule: 太さ thickness の帯 (背景色つき BlockArea)。中心は、横書きは基線、縦書きは字面の中央
 */
function leaderNode(a: Atom, off: number, gStart: number, w: number, bOff: number, wm: WritingMode, lineEnd?: number): LNode {
  const ld = a.leader!;
  const fs = a.st.fontSize;
  const node = newNode('block', wm, { i: off - gStart, b: bOff, isize: w, bsize: fs, src: a.src });
  if (ld.pattern === 'dots' && ld.g && ld.pitch > 0) {
    // 置く位置: 行頭からピッチの倍数の位置 (複数行で縦に揃う)。CSS の leader() は、終わり側の端から始め側へ並べる (Content 3 §2.5.3。
    // 終わり側が揃う行どうしで縦に揃う)
    const xs: number[] = [];
    // CSS: 行の終わりの端を基準に並べ (Content 3 §5.3)、リーダーの範囲 (前後の中身に重ならない所) に収まる字だけを描く
    if (ld.css && ld.fromStart) {
      for (let x = off; x + ld.pitch <= off + w + EPS; x += ld.pitch) xs.push(x);
    } else if (ld.css) {
      const end = lineEnd ?? off + w;
      const first = end - Math.ceil((end - (off + w)) / ld.pitch - EPS) * ld.pitch;
      for (let x = first - ld.pitch; x >= off - EPS; x -= ld.pitch) xs.unshift(x);
    }
    else for (let m = Math.ceil((off - EPS) / ld.pitch); m * ld.pitch + ld.pitch <= off + w + EPS; m++) xs.push(m * ld.pitch);
    for (const x of xs) {
      if (ld.gs) {
        // 文字列の繰り返し: 単位の中に字を順に並べる
        let dx = 0;
        for (const g of ld.gs) {
          const gn = glyphNode(g, a.st, wm, g.ch, fs, a.st.color);
          gn.i = x - off + dx;
          gn.b = 0;
          node.children.push(gn);
          dx += g.advance;
        }
        continue;
      }
      const gn = glyphNode(ld.g, a.st, wm, ld.g.ch, fs, a.st.color);
      gn.i = x - off + (ld.pitch - ld.g.advance) / 2;
      gn.b = 0;
      node.children.push(gn);
    }
  } else if (ld.pattern === 'rule' && w > 0) {
    // 線の中心は基線 (横書き)・字面の中央 (縦書き)。太さはその上下に等しく付ける (§7.22.6「thickened equally above and
    // below the line's alignment position」)
    const br = DEFAULT_BASELINE_RATIO;
    const center = wm !== 'horizontal-tb' ? fs / 2 : br * fs;
    // 線種 (dotted・dashed・double など) は、太さ = 線の幅の罫線で描く
    const rule = ld.ruleStyle
      ? newNode('block', wm, { i: 0, b: center - ld.thickness / 2, isize: w, bsize: ld.thickness, border: { [wm === 'horizontal-tb' ? 'top' : wm === 'vertical-lr' ? 'left' : 'right']: { width: ld.thickness, color: a.st.color, style: ld.ruleStyle } } })
      : newNode('block', wm, { i: 0, b: center - ld.thickness / 2, isize: w, bsize: ld.thickness, bg: a.st.color });
    node.children.push(rule);
  }
  return node;
}

/**
 * 下線・上線・取り消し線を、inline の範囲いっぱいに引く (inline の子として、文字の上に描く)。
 * 横書き: 下線は基線の少し下、上線は字面の上端、取り消し線は x ハイト付近。
 * 縦書き: 下線は行の左 (block 方向の後ろ)、上線は右、取り消し線は字面の中央。
 * 線の種類・太さ・下線のずらし (CSS の text-decoration-style・text-decoration-thickness・text-underline-offset) の指定が無ければ、
 * 字の大きさの 6% (0.5pt 以上) の実線。font は、書体の下線の太さ (from-font) を引く書体
 */
function addDecorations(inline: LNode, st: ResolvedStyle, lm: LineMetrics, span: number, wm: WritingMode, font?: import('./fontManager').LoadedFont) {
  const d = st.textDecoration;
  if (!d || !(d.underline || d.overline || d.lineThrough) || span <= 0) return;
  const fs = st.fontSize;
  const t = Math.max(fs * 0.06, 0.5);
  const vertical = wm !== 'horizontal-tb';
  const base = lm.above; // inline の中での基線 (縦書きは字面の中央)
  const sign = wm === 'vertical-lr' ? -1 : 1; // vertical-lr は block 方向が左→右なので、下線 (左) は block の前側
  // 線の色: 線を指定した要素の色 (colors)。無ければ字の色
  const lines: Array<[number, string, 'underline' | 'overline' | 'lineThrough']> = [];
  if (d.underline) lines.push([vertical ? base + sign * fs * 0.58 : base + fs * 0.12, d.colors?.underline ?? st.color, 'underline']);
  if (d.overline) lines.push([vertical ? base - sign * fs * 0.58 : base - fs * 0.9, d.colors?.overline ?? st.color, 'overline']);
  if (d.lineThrough) lines.push([vertical ? base : base - fs * 0.3, d.colors?.lineThrough ?? st.color, 'lineThrough']);
  if (!d.styles && !d.thickness && d.underlineOffset === undefined) {
    for (const [y, color] of lines) inline.children.push(newNode('block', wm, { i: 0, b: y - t / 2, isize: span, bsize: t, bg: color }));
    return;
  }
  // 罫線で描く線 (点線・破線・波線) の辺: 行の進む向きに沿う辺 (リーダーの罫線と同じ)
  const side = wm === 'horizontal-tb' ? 'top' : wm === 'vertical-lr' ? 'left' : 'right';
  for (const [y, color, kind] of lines) {
    // 太さ (Text Decoration 4 §2.4): 長さ・百分率は指定の値 (装置の 1 画素を下限にする。印刷では画素が決まらないので、300dpi の 1 画素 = 0.24pt)。
    // from-font は書体の下線の太さ (post の表の underlineThickness)。書体に無ければ auto と同じ
    const th = d.thickness?.[kind];
    const fromFont = th === 'from-font' && font ? ((font.fk as { underlineThickness?: number }).underlineThickness ?? 0) / font.unitsPerEm : 0;
    const w = typeof th === 'number' ? Math.max(th, 0.24) : fromFont > 0 ? fromFont * fs : t;
    // 字から離れる向き (block 方向の符号)。取り消し線は 0 (中心を保つ)
    const out = kind === 'lineThrough' ? 0 : kind === 'underline' ? (vertical ? sign : 1) : vertical ? -sign : -1;
    // 太さを変えても、字に近い側の端は動かさない (下線・上線は外へ太る)。取り消し線は中心を保つ
    let centre = y + (out * (w - t)) / 2;
    if (kind === 'underline' && d.underlineOffset !== undefined) {
      // 下線のずらし (Text Decoration 4 §2.8.1): text-underline-position が auto のときの基準は欧文の基線で、正の値は字から離れる向き。
      // 線は、その位置から外へ太さの分だけ引く。縦書きの欧文の基線は、字面の中央から下線の側へ (基線の比 − 0.5) em の所
      const zero = vertical ? base + sign * (DEFAULT_BASELINE_RATIO - 0.5) * fs : base;
      centre = zero + out * (d.underlineOffset + w / 2);
    }
    const style = d.styles?.[kind] ?? 'solid';
    const bar = (c: number) => inline.children.push(newNode('block', wm, { i: 0, b: c - w / 2, isize: span, bsize: w, bg: color }));
    if (style === 'double') {
      // 二重線 (border-style の double と同じ意味。Backgrounds 3 §3.2: 2 本の線と、その間の空き)。同じ太さの線 2 本を、太さと同じだけ空けて引く。
      // 2 本目は外側 (取り消し線は中心の両側)
      if (out === 0) (bar(centre - w), bar(centre + w));
      else (bar(centre), bar(centre + out * 2 * w));
    } else if (style === 'dotted' || style === 'dashed') {
      inline.children.push(newNode('block', wm, { i: 0, b: centre - w / 2, isize: span, bsize: w, border: { [side]: { width: w, color, style } } }));
    } else if (style === 'wavy') {
      // 波線: 太さ w の線が、実線の位置を中心に上下へ w ずつ振れる (幅 3w の帯)。周期は太さの 6 倍
      inline.children.push(newNode('block', wm, { i: 0, b: centre - 1.5 * w, isize: span, bsize: 3 * w, border: { [side]: { width: 3 * w, color, style: 'wave', waveStroke: w, waveLength: 6 * w } } }));
    } else bar(centre);
  }
}

export function buildLineNode(
  pl: PositionedLine,
  lm: LineMetrics,
  extraBefore: number,
  wm: WritingMode,
  L: number,
): LNode {
  const emTop = extraBefore + lm.leading / 2;
  const line = newNode('line', wm, {
    isize: L,
    bsize: extraBefore + lm.base,
    hasRuby: lm.rubyExtent > 0,
    contentLength: pl.contentLength,
    baseline: emTop + lm.above,
  });
  // 改訂バー: この行の文字に付いたもの (同じ指定は 1 本)
  const revs = new Set(pl.raw.items.map((a) => a.st.revisionBar).filter((r) => r !== undefined));
  if (revs.size) line.revs = [...revs];

  const entries: { a: Atom; off: number; w: number; ov?: number[]; dx?: number }[] = pl.raw.items.map((a, k) => ({ a, off: pl.offsets[k], w: pl.widths[k], ov: pl.overhang?.[k], dx: pl.shrinkDx?.[k] }));
  if (pl.raw.hang && pl.hangOffset !== undefined) entries.push({ a: pl.raw.hang, off: pl.hangOffset, w: pl.raw.hang.advance });

  let k = 0;
  while (k < entries.length) {
    // 同一 run の連続する atom を 1 つの InlineArea にまとめる
    let e = k + 1;
    while (e < entries.length && entries[e].a.runId === entries[k].a.runId) e++;
    const group = entries.slice(k, e);
    // 右から左の行では、続く atom ほど左にある。範囲は位置の最小・最大で取る
    const gStart = Math.min(...group.map((g) => g.off));
    const span = Math.max(...group.map((g) => g.off + g.w)) - gStart;
    // 字の背景は、字の大きさの箱 (em の箱) に塗る (行送りの高さには塗らない)。字の並びの箱は動かさず、背景は別の箱で描く
    const bg = group[0].a.bg;
    if (bg) {
      const ext = emExtent(group.map((g) => g.a), lm, emTop, wm);
      line.children.unshift(newNode('block', wm, { i: gStart, b: ext.top, isize: span, bsize: ext.size, bg }));
    }
    const inline = newNode('inline', wm, { i: gStart, b: emTop, isize: span, bsize: lm.em });
    for (const { a, off, w, ov, dx } of group) {
      // 字は、その字の書体の基線の位置で置く (代わりの書体の字も、行の基線にそろえる)
      const ab = atomAboveBelow(a.primaryRatio === undefined ? a : { ...a, primaryRatio: undefined }, wm);
      const bOff = lm.above - ab.above; // 行の em ボックス内でのこの atom の block 方向位置
      if (a.kind === 'glyph' && a.g && a.hidden) {
        // 描かない字 (単独の ZWNJ・LRM など): 字形を置かない
      } else if (a.kind === 'glyph' && a.g) {
        const gn = glyphNode(a.g, a.st, wm, a.first, a.st.fontSize, a.st.color, a.src, a.cite);
        if (a.ref !== undefined) gn.ref = a.ref;
        gn.i = off - gStart + (a.dx ?? 0) + (dx ?? 0);
        gn.b = bOff - (a.shift ?? 0);
        inline.children.push(gn);
      } else if (a.kind === 'box' && a.box) {
        a.box.node.i = off - gStart;
        a.box.node.b = bOff - (a.shift ?? 0);
        // 箱の atom に付いた id (中身の無い inline・先頭が画像の inline など) も、置いたページで記録する
        if (a.src && !a.box.node.src) a.box.node.src = a.src;
        inline.children.push(a.box.node);
      } else if (a.kind === 'leader' && a.leader) {
        inline.children.push(leaderNode(a, off, gStart, w, bOff, wm, L));
      } else if (a.kind === 'ruby' && a.r) {
        const r = a.r;
        const [ovL, ovR] = ov ?? [0, 0];
        const rn = newNode('ruby', wm, {
          i: off - gStart - ovL,
          b: bOff - r.rubyExtent,
          isize: r.advance,
          bsize: a.st.fontSize + r.rubyExtent + (r.underExtent ?? 0),
          rubyExtent: r.rubyExtent,
          baseCount: r.baseGlyphs.length,
          src: a.src,
          ref: a.ref,
        });
        // 前後の字に掛けた分は、親文字を置かない (親文字はルビの範囲の内側 [ovL, advance - ovR] に均等に置く)
        const baseOff = rubyOffsets(r.baseGlyphs, r.advance - ovL - ovR, a.rubyAligns?.[2]).map((x) => x + ovL);
        r.baseGlyphs.forEach((g, idx) => {
          const gn = glyphNode(g, a.st, wm, g.ch, a.st.fontSize, a.st.color);
          gn.i = baseOff[idx];
          gn.b = r.rubyExtent;
          rn.children.push(gn);
        });
        const rubyOff = rubyOffsets(r.rubyGlyphs, r.advance, a.rubyAligns?.[0]);
        r.rubyGlyphs.forEach((g, idx) => {
          const gn = glyphNode(g, a.st, wm, g.ch, r.rubySize, a.rubyColors?.[0] ?? a.st.color);
          gn.i = rubyOff[idx];
          gn.b = 0;
          rn.children.push(gn);
        });
        // 下側のルビ (2 段目): 親文字の下に置く
        if (r.underGlyphs) {
          const underOff = rubyOffsets(r.underGlyphs, r.advance, a.rubyAligns?.[1]);
          r.underGlyphs.forEach((g, idx) => {
            const gn = glyphNode(g, a.st, wm, g.ch, r.rubySize, a.rubyColors?.[1] ?? a.st.color);
            gn.i = underOff[idx];
            gn.b = r.rubyExtent + a.st.fontSize;
            rn.children.push(gn);
          });
        }
        inline.children.push(rn);
      } else if (a.kind === 'tcy' && a.t) {
        const t = a.t;
        const fs = a.st.fontSize;
        const tn = newNode('tcy', wm, {
          i: off - gStart,
          b: bOff,
          isize: t.advance,
          bsize: fs,
          tcyScale: t.scale,
          tcyFrames: t.frames,
          src: a.src,
          ref: a.ref,
        });
        // 内部は横組み。物理座標 (x: 水平, y: 垂直) を直接指定する
        const total = t.naturalWidth * t.scale;
        let cx = (fs - total) / 2;
        const top = (t.advance - fs) / 2;
        const br = t.font.baselineRatio;
        for (const c of t.chars) {
          const w = c.width * t.scale;
          const gn = newNode('glyph', 'horizontal-tb', {
            isize: w,
            bsize: fs,
            phys: { x: cx, y: top },
            glyph: {
              text: c.ch,
              // 幅を測った書体で描く (先頭の字の書体に無い字は、代替の書体)
              fontFamily: c.font.family,
              fontWeight: c.font.weight,
              fontSize: fs,
              color: a.st.color,
              baselineX: 0,
              baselineY: br * fs,
              rotation: 0,
              scaleX: t.scale,
              advance: w,
            },
          });
          cx += w;
          tn.children.push(gn);
        }
        inline.children.push(tn);
      }
    }
    addDecorations(inline, group[0].a.st, lm, span, wm, group[0].a.st.textDecoration?.thickness ? group.find((g) => g.a.g)?.a.g?.font : undefined);
    line.children.push(inline);
    k = e;
  }
  drawInlineFrames(line, entries, lm, emTop, wm, !!pl.rtl);
  return line;
}

/**
 * 罫線・余白つきの inline の枠 (背景 + 罫線) を、行の文字の下に描く。
 * 行の中で始まって終わる枠はそのまま、行をまたぐ枠は、切れ目の側の罫線・余白を描かない (box-decoration-break: slice 相当)
 */
/**
 * 字の並びの、字の大きさの箱 (em の箱) の上端と高さ。横書きは、字ごとの基準線より上と下の最大 (基準線は行の emTop + above)。
 * 縦書き・字の無い並びは、行の em の箱
 */
function emExtent(atoms: Atom[], lm: LineMetrics, emTop: number, wm: WritingMode): { top: number; size: number } {
  const glyphs = atoms.filter((a) => a.kind === 'glyph' && !a.frameOpen && !a.frameClose && !a.shift);
  if (wm !== 'horizontal-tb' || !glyphs.length || glyphs.length !== atoms.filter((a) => !a.frameOpen && !a.frameClose).length) return { top: emTop, size: lm.em };
  let A = 0;
  let B = 0;
  for (const a of glyphs) {
    const ab = atomAboveBelow(a, wm);
    A = Math.max(A, ab.above);
    B = Math.max(B, ab.below);
  }
  return { top: emTop + lm.above - A, size: A + B };
}

function drawInlineFrames(line: LNode, entries: { a: Atom; off: number; w: number }[], lm: LineMetrics, emTop: number, wm: WritingMode, rtl: boolean) {
  if (!entries.some((e) => e.a.frames?.length)) return;
  // この行に現れる枠ごとに、この行で枠に入っている atom (始端・終端の余白を含む) の範囲と、行の切れ目で切れた側を求める
  const spans = new Map<number, { frame: InlineFrame; cutStart: boolean; cutEnd: boolean; depth: number; first: boolean; lo: number; hi: number; atoms: Atom[] }>();
  for (const e of entries) {
    (e.a.frames ?? []).forEach((f, depth) => {
      let sp = spans.get(f.id);
      if (!sp) spans.set(f.id, (sp = { frame: f, cutStart: true, cutEnd: true, depth, first: false, lo: Infinity, hi: -Infinity, atoms: [] }));
      sp.atoms.push(e.a);
      sp.lo = Math.min(sp.lo, e.off);
      sp.hi = Math.max(sp.hi, e.off + e.w);
      if (e.a === f.first) sp.first = true;
      if (e.a.frameOpen === f) sp.cutStart = false;
      if (e.a.frameClose === f) sp.cutEnd = false;
    });
  }
  // 内側の枠ほど後 (手前) に描く。どれも文字より奥 (行の先頭) に入れる
  const list = [...spans.values()].sort((x, y) => y.depth - x.depth);
  for (const sp of list) {
    const f = sp.frame;
    if (f.link || (f.annot && sp.first)) {
      // リンク・注釈の範囲 (描画しない箱)
      line.children.push(newNode('block', wm, { i: sp.lo, b: emTop, isize: Math.max(sp.hi - sp.lo, 0), bsize: lm.em, link: f.link, annot: sp.first ? f.annot : undefined }));
    }
    if (!f.box) continue;
    const pl = toLogical(f.padding, wm);
    const bl = borderToLogicalWidths(f.border, wm);
    const border: BorderStyle = { ...f.border };
    const phys = (k: 'is' | 'ie') => (wm === 'horizontal-tb' ? ((k === 'is') !== rtl ? 'left' : 'right') : k === 'is' ? 'top' : 'bottom');
    if (sp.cutStart) delete border[phys('is')];
    if (sp.cutEnd) delete border[phys('ie')];
    // 枠は、中の字の大きさの箱 (em の箱) を囲む (行送りの高さでは囲まない)
    const ext = emExtent(sp.atoms, lm, emTop, wm);
    line.children.unshift(
      newNode('block', wm, {
        i: sp.lo,
        b: ext.top - pl.bs - bl.bs,
        isize: Math.max(sp.hi - sp.lo, 0),
        bsize: ext.size + pl.bs + pl.be + bl.bs + bl.be,
        border,
        bg: f.bg,
        ...(f.radius ? { radius: f.radius } : {}),
      }),
    );
  }
}

/**
 * CSS の leader() は 1 行にだけ現れる (Content 3 §2.5.2: 前の内容と後ろの内容が別の行になっても)。
 * leader の後ろ (強制改行まで) の字の前では改行しないようにする
 */
export function glueAfterCssLeaders(atoms: Atom[]): void {
  let on = false;
  for (const a of atoms) {
    if (a.kind === 'break') on = false;
    else if (on) a.glue = true;
    if (a.kind === 'leader' && a.leader?.css) on = true;
  }
}

/** 強制改行 (atoms[k]) の次の行の始まり。行頭の、詰める空白 (white-space: normal など) は取り除く (CSS Text 3 §4.1.2) */
/** atoms[start] から始まる行が、強制改行の後の行か (afterForcedBreak で飛ばした空白をさかのぼって、改行の atom を探す) */
export function startsAfterForcedBreak(atoms: Atom[], start: number): boolean {
  let k = start - 1;
  while (k >= 0 && atoms[k].kind === 'glyph' && atoms[k].isSpace && atoms[k].st.collapseSpaces) k--;
  return k >= 0 && atoms[k].kind === 'break';
}

function afterForcedBreak(atoms: Atom[], k: number): number {
  let next = k + 1;
  while (next < atoms.length && atoms[next].kind === 'glyph' && atoms[next].isSpace && atoms[next].st.collapseSpaces) next++;
  return next;
}

