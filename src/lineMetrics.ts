/**
 * lineMetrics — 行の高さ (基線の上下・半行間) の計算。
 *
 * 行の高さのモデルは 3 つに分かれる (入口は lineMetrics → lineMetricsBase が fallback の種類で選ぶ):
 *  - XSL モデル (lineMetricsXsl): XSL 1.1 §4.5 の line-stacking-strategy をそのまま実装したもの (xslLineStacking、または font-height)
 *  - 互換 (AH) モデル (lineMetricsAh): XSL-FO の入力の互換モードの挙動 (boxLineHalfLeading・blockLeadingMaxHeight・
 *    字ごとの書体の上下 fontLineMetrics)
 *  - CSS モデル (lineMetricsCss): CSS 2.1 §10.8 の支柱 (strut) と、最初に使える書体の上下 (primaryFontMetrics)。
 *    互換の印の無い入力 (API から直接組むときなど) も、この入口で組む (CSS 固有の分岐が働かないだけ)
 *    HTML の横書きの行 (fontBaseline) は、行の中身ごとの上下 (最初に使える書体の A・D と半行間) を基線でそろえて囲む (layoutBoundsMetrics。
 *    CSS Inline 3 §5.3)
 * 3 つのモデルで共通の段階 (行の中身の走査・line-height 戦略・字ごとの書体の上下・持ち上げた字の広がり) は、下の補助関数で共有する。
 */
import type { WritingMode } from './types';
import { lineHeightOf, type ResolvedStyle } from './lnode';
import type { Atom, PositionedLine } from './inlineLayout';

/** 基線の位置 (字の上端からの比) の既定値。書体の計測が無いとき (支柱・leader の線・箱の揃えなど) に使う */
export const DEFAULT_BASELINE_RATIO = 0.88;

export interface LineMetrics {
  above: number;
  below: number;
  em: number;
  leading: number;
  rubyExtent: number;
  base: number;
  /** 行の上端から、行の中の字の上端 (書体の ascent) までの空き (上の半行間)。無ければ leading / 2 */
  topLeading?: number;
  /** 行の中の字の下端 (書体の descent) から、行の下端までの空き (下の半行間)。無ければ leading / 2 */
  bottomLeading?: number;
  /**
   * 後ろ側 (横書きは下、縦書きは行の並ぶ向きの後ろ) に置いたルビ・圏点のある CSS の行で、行間に収まらない注釈の分として空ける量
   * (CSS Ruby 1 §3.6)。rubyBefore は行の前に足す分、rubyAfter は行の後ろに足す分 (base に含めてある)。
   * 無ければ、足りない分 (rubyExtent − leading) をすべて行の前に足す
   */
  rubyBefore?: number;
  rubyAfter?: number;
}

/** atom の基線の上下 (em の箱。箱はその上下、ルビは下側の張り出しを含む) */
export function atomAboveBelow(a: Atom, wm: WritingMode): { above: number; below: number } {
  const fs = a.st.fontSize;
  if (a.box) return wm !== 'horizontal-tb' ? { above: a.box.cross / 2, below: a.box.cross / 2 } : { above: a.box.above, below: a.box.below };
  // 下側のルビは、親文字の下に張り出す
  // (ruby-position: under のルビ (roomExtent) は、上側のルビと同じく行の高さに数えない。CSS Ruby 1 §3.6)
  const under = a.r?.roomExtent !== undefined ? 0 : (a.r?.underExtent ?? 0);
  if (wm !== 'horizontal-tb') return { above: fs / 2, below: fs / 2 + under };
  const br = a.primaryRatio ?? a.g?.font.baselineRatio ?? a.r?.baseGlyphs[0]?.font.baselineRatio ?? a.t?.font.baselineRatio ?? a.leader?.g?.font.baselineRatio ?? DEFAULT_BASELINE_RATIO;
  return { above: br * fs, below: (1 - br) * fs + under };
}

/**
 * XSL 1.1 §4.5 の行の高さ。block はブロック (行を作る要素) の書式。
 *  - nominal-requested-line-rectangle: ブロックの字の上 (text-altitude) と下 (text-depth) の矩形
 *  - 半行間 = (ブロックの line-height − (上 + 下)) / 2
 *  - font-height: 行の矩形は nominal。上下に半行間 (行送りはいつも line-height)
 *  - max-height (初期値): nominal と、行の中の各 inline の矩形 (baseline-shift でずらした位置) を囲む。上下に半行間
 *  - line-height: nominal を半行間だけ広げたものと、各 inline の矩形をその inline の半行間だけ広げたものを囲む (上下の余白は 0)
 */
function lineMetricsXsl(pl: PositionedLine, wm: WritingMode, block: ResolvedStyle): LineMetrics {
  const atoms = pl.raw.items.length ? pl.raw.items : [pl.raw.metric ?? ({ st: block, kind: 'break' } as Atom)];
  const all = pl.raw.hang ? [...atoms, pl.raw.hang] : atoms;
  // 字の上下 (text-altitude・text-depth。初期値 use-font-metrics): 書体の ascent・descent。縦書きは em の半分ずつ。
  // 代わりの書体の字 (和文の書体で組んだ漢字・仮名など) は、最初に使える書体 (primaryFont) の上下: 欧文だけの行と基線をそろえる
  const altDep = (a: Atom): { above: number; below: number } => {
    const f = a.primaryFont ?? a.g?.font;
    if (wm === 'horizontal-tb' && a.kind === 'glyph' && f?.ascent !== undefined && f.descent !== undefined) return { above: f.ascent * a.st.fontSize, below: f.descent * a.st.fontSize };
    return atomAboveBelow(a, wm);
  };
  // ブロックの字の上下: ブロックと同じ書体の字があればその書体の値、無ければ em の箱
  // 書体の指定は、斜体の書体・幅の違う書体を指す印 (ResolvedStyle.fontFamilySpec) を外した名前で比べる
  const same = all.find((a) => a.kind === 'glyph' && a.g && (a.st.fontFamilySpec ?? a.st.fontFamily) === (block.fontFamilySpec ?? block.fontFamily) && !a.isSpace);
  const fs = block.fontSize;
  const sf = same?.primaryFont ?? same?.g?.font;
  const horiz = wm === 'horizontal-tb';
  const nA = horiz ? (sf?.ascent !== undefined ? sf.ascent : (sf?.baselineRatio ?? DEFAULT_BASELINE_RATIO)) * fs : fs / 2;
  const nB = horiz ? (sf?.descent !== undefined ? sf.descent : 1 - (sf?.baselineRatio ?? DEFAULT_BASELINE_RATIO)) * fs : fs / 2;
  const hl = (lineHeightOf(block) - (nA + nB)) / 2;
  let rubyExtent = 0;
  for (const a of all) if (a.r) rubyExtent = Math.max(rubyExtent, a.r.roomExtent ?? a.r.rubyExtent);
  const strategy = block.lineStackingStrategy ?? 'max-height';
  // 半行間は leading (上下に半分ずつ) で表す。負の半行間 (line-height が字より小さい) は、上下の矩形に含めて表す
  const withLeading = (a: number, b: number, h: number): LineMetrics =>
    h >= 0 ? { above: a, below: b, em: a + b, leading: 2 * h, rubyExtent, base: a + b + 2 * h } : { above: a + h, below: b + h, em: Math.max(a + b + 2 * h, 0), leading: 0, rubyExtent, base: Math.max(a + b + 2 * h, 0) };
  if (strategy === 'font-height') return withLeading(nA, nB, hl);
  let A = strategy === 'line-height' ? nA + hl : nA;
  let B = strategy === 'line-height' ? nB + hl : nB;
  for (const a of all) {
    if (a.kind === 'break' || (a.kind === 'box' && (a.frameOpen || a.frameClose))) continue;
    // 空白は字の形を持たないので、行の高さに入れない (和文の書体の行の空白が、欧文の書体で組まれても行を広げない)
    if (a.kind === 'glyph' && a.isSpace) continue;
    const ab = altDep(a);
    const shift = a.shift ?? 0;
    // line-height: 字 (中身の無い inline) の矩形を、その字の半行間だけ広げる。画像などの箱は広げない
    const own = strategy === 'line-height' && a.kind !== 'box' ? (lineHeightOf(a.st) - (ab.above + ab.below)) / 2 : 0;
    A = Math.max(A, ab.above + shift + own);
    B = Math.max(B, ab.below - shift + own);
  }
  if (strategy === 'line-height') return { above: A, below: B, em: A + B, leading: 0, rubyExtent, base: A + B };
  return withLeading(A, B, hl);
}

/**
 * lineMetrics の nominalRatio: ブロックの nominal-font (XSL §5.5.7) の基準線の位置 (字の上端からの比)。
 * 字の無い行・画像などの箱のある行の、ブロックの字の矩形 (nominal-requested-line-rectangle。§4.5) に使う
 */
/**
 * 行の高さ。strut を渡すと、行の高さの下限に支柱 (ブロックの最初に使える書体と line-height を持つ、幅 0 の行内の箱) の上下を入れる
 * (CSS 2.1 §10.8.1。基線の上・下の長さ)
 */
/**
 * 行の高さ。vertical-align: top・bottom の箱 (lineAlign) は、ほかの中身で行の高さを決めてから、行の箱の上端・下端に揃える
 * (CSS 2.1 §10.8.1・§10.8: 揃える箱が行より高ければ、その分だけ行を広げる)。揃えた位置は箱の shift に入れる
 */
export function lineMetrics(
  pl: PositionedLine,
  wm: WritingMode,
  fallback: ResolvedStyle,
  nominalRatio?: number,
  strut?: { above: number; below: number },
  nominalDiff?: number,
): LineMetrics {
  return withAfterRubyRoom(lineMetricsAligned(pl, wm, fallback, nominalRatio, strut, nominalDiff), pl);
}

/**
 * 後ろ側 (横書きは下) に置いた注釈のある CSS の行 (ruby-position: under など。RubyMetrics.roomExtent のあるルビ): CSS Ruby 1 §3.6。
 * line-height が、前の側の注釈の端から後ろ側の注釈の端までより小さいとき、同じ行を重ねても注釈が重ならないだけの空き (注釈の厚さの合計 − 行間) を、
 * 注釈のある側に足す (「additional leading is added on the appropriate side(s) of the ruby base container」)。両側にあれば、厚さの割合で分ける。
 * 前の側だけの行は、これまでどおり (足りない分をすべて行の前に足す。layoutEngine の rubyRoom)
 */
function withAfterRubyRoom(m: LineMetrics, pl: PositionedLine): LineMetrics {
  let before = 0;
  let after = 0;
  for (const a of pl.raw.hang ? [...pl.raw.items, pl.raw.hang] : pl.raw.items) {
    if (!a.r) continue;
    before = Math.max(before, a.r.rubyExtent);
    if (a.r.roomExtent !== undefined) after = Math.max(after, a.r.underExtent ?? 0);
  }
  if (!(after > 0)) return m;
  const lack = Math.max(0, before + after - m.leading);
  const rubyAfter = (lack * after) / (before + after);
  return { ...m, base: m.base + rubyAfter, rubyBefore: lack - rubyAfter, rubyAfter };
}

function lineMetricsAligned(
  pl: PositionedLine,
  wm: WritingMode,
  fallback: ResolvedStyle,
  nominalRatio?: number,
  strut?: { above: number; below: number },
  nominalDiff?: number,
): LineMetrics {
  const aligned = pl.raw.items.filter((a) => a.lineAlign && a.box);
  if (!aligned.length) return lineMetricsBase(pl, wm, fallback, nominalRatio, strut, nominalDiff);
  const rest = pl.raw.items.filter((a) => !(a.lineAlign && a.box));
  const base: PositionedLine = { ...pl, raw: { ...pl.raw, items: rest, ...(rest.length ? {} : { metric: pl.raw.metric ?? ({ st: fallback, kind: 'break' } as Atom) }) } };
  const m = lineMetricsBase(base, wm, fallback, nominalRatio, strut, nominalDiff);
  let up = m.above + (m.topLeading ?? m.leading / 2);
  let down = m.below + (m.bottomLeading ?? m.leading / 2);
  // 背の高い箱は行を広げる: 下に揃える箱は上へ、上に揃える箱は下へ
  let extraA = 0;
  let extraB = 0;
  for (const a of aligned) {
    const h = a.box!.above + a.box!.below;
    const over = h - (up + down);
    if (over <= 0) continue;
    if (a.lineAlign === 'bottom') extraA = Math.max(extraA, over);
    else extraB = Math.max(extraB, over);
  }
  up += extraA;
  down += extraB;
  // shift は上向きが正。下に揃える箱の下端を行の下端 (基線の下 down) に、上に揃える箱の上端を行の上端 (基線の上 up) に
  for (const a of aligned) a.shift = a.lineAlign === 'bottom' ? a.box!.below - down : up - a.box!.above;
  if (!extraA && !extraB) return m;
  return { ...m, above: m.above + extraA, below: m.below + extraB, em: m.em + extraA + extraB, base: m.base + extraA + extraB };
}

function lineMetricsBase(pl: PositionedLine, wm: WritingMode, fallback: ResolvedStyle, nominalRatio?: number, strut?: { above: number; below: number }, nominalDiff?: number): LineMetrics {
  if (fallback.xslLineStacking || fallback.lineStackingStrategy === 'font-height') return lineMetricsXsl(pl, wm, fallback);
  // 互換 (AH) モデルの印のあるブロック (XSL-FO の入力)。CSS の印 (primaryFontMetrics) と同時に付くことは無い (HTML と XSL-FO の取り込みが別々に付ける)
  if (fallback.boxLineHalfLeading || fallback.blockLeadingMaxHeight) return lineMetricsAh(pl, wm, fallback, nominalRatio, strut, nominalDiff);
  return lineMetricsCss(pl, wm, fallback, nominalRatio, strut);
}

// ───────────────────────── 3 つのモデルで共有する段階 ─────────────────────────

/** 行の atom の並び。atoms は行の中身 (中身の無い行は改行の印 metric だけ)、all はぶら下げた字 (hang) も含む */
function lineAtoms(pl: PositionedLine, fallback: ResolvedStyle): { atoms: Atom[]; all: Atom[] } {
  const atoms = pl.raw.items.length ? pl.raw.items : [pl.raw.metric ?? ({ st: fallback, kind: 'break' } as Atom)];
  const all = pl.raw.hang ? [...atoms, pl.raw.hang] : atoms;
  return { atoms, all };
}

/** 行内の箱 (画像・数式・inline-block など。枠の始まり・終わりの空きは除く) */
const isInlineBox = (a: Atom): boolean => a.kind === 'box' && !a.frameOpen && !a.frameClose;

/** 中身の無い行 (強制改行だけの行。pre の空行など): 行の箱は支柱だけ (CSS 2.1 §10.8.1)。字の無い改行の印は書体を持たないので、
 * em の箱の値で測ると、支柱の (書体の) 上下と混ざって行が高くなる */
function strutOnlyLine(all: Atom[], strut: { above: number; below: number } | undefined): LineMetrics | undefined {
  if (!strut || !all.every((a) => a.kind === 'break' || (a.kind === 'box' && a.idMark))) return undefined;
  const h = strut.above + strut.below;
  return { above: strut.above, below: strut.below, em: h, leading: 0, rubyExtent: 0, base: h };
}

interface LineScan {
  above: number;
  below: number;
  /** 行の中の line-height の最大 */
  lh: number;
  rubyExtent: number;
}

/**
 * 行の中身を走査して、基線の上下の最大・line-height の最大・ルビの張り出しを集める。
 * excludeBoxLineHeight (CSS): 置換要素・inline-block などの行内の箱の高さは margin の箱の高さで、line-height は使わない (CSS 2.1 §10.8.1)。
 * 行の line-height は字と支柱から (ブロックの画像 (display: block の img) の行が、画像の高さより高くならない)
 */
function scanLine(all: Atom[], wm: WritingMode, excludeBoxLineHeight: boolean): LineScan {
  let above = 0;
  let below = 0;
  let lh = 0;
  let rubyExtent = 0;
  for (const a of all) {
    // HTML の互換モード: 中身の無い行内の箱 (幅 0 の目印) と空白だけの字は、line-height を 0 とみなす (Quirks Mode §3.3)。
    // 行内の箱の上下は、半行間が字の上下を打ち消して 0 になるので、行の高さに入れない
    if (a.st.lineHeightQuirk && ((a.kind === 'box' && a.idMark) || (a.kind === 'glyph' && a.isSpace))) continue;
    const ab = atomAboveBelow(a, wm);
    // ずらした箱 (画像・数式など) は、ずらした位置の上下で行の高さを決める
    const bs = a.kind === 'box' ? (a.shift ?? 0) : 0;
    above = Math.max(above, ab.above + bs);
    below = Math.max(below, ab.below - bs);
    if (!(excludeBoxLineHeight && isInlineBox(a) && a.box)) lh = Math.max(lh, lineHeightOf(a.st));
    if (a.r) rubyExtent = Math.max(rubyExtent, a.r.roomExtent ?? a.r.rubyExtent);
  }
  return { above, below, lh, rubyExtent };
}

/** line-stacking-strategy="line-height" の字だけの行: 行の高さは line-height そのもの (負の行間。字は行の外へはみ出す) */
function lineHeightStrategyMetrics(atoms: Atom[], sc: LineScan): LineMetrics | undefined {
  const { above, below, lh, rubyExtent } = sc;
  if (!(lh < above + below && atoms.every((a) => a.st.lineStackingStrategy === 'line-height' && (a.kind !== 'box' || !!a.frameOpen || !!a.frameClose) && a.kind !== 'ruby' && !a.shift))) return undefined;
  const half = (lh - (above + below)) / 2;
  return { above: above + half, below: below + half, em: lh, leading: 0, rubyExtent, base: lh };
}

/**
 * CSS の支柱 (strut): 行には、ブロックの書体と line-height の支柱がある (CSS 2.1 §10.8.1)。字の無い、画像などの箱だけの行でも、
 * 基線の下に支柱の下がり (字の下がり + 半行間) を空ける (字のある行は、字がその高さを持つ)。横書きの行だけ
 */
function raiseToStrutForBoxLine(sc: LineScan, all: Atom[], wm: WritingMode, fallback: ResolvedStyle, nominalRatio: number | undefined): void {
  if (fallback.noStrut || wm !== 'horizontal-tb') return;
  if (!all.some((a) => isInlineBox(a) && a.box && !a.idMark) || all.some((a) => a.kind === 'glyph' && !a.isSpace)) return;
  const br = nominalRatio ?? DEFAULT_BASELINE_RATIO;
  const half = (lineHeightOf(fallback) - fallback.fontSize) / 2;
  sc.above = Math.max(sc.above, br * fallback.fontSize + half);
  sc.below = Math.max(sc.below, (1 - br) * fallback.fontSize + half);
}

/**
 * 字だけの行 (行内の箱・ルビ・ずらした字の無い行) か。line-height が字の上下より小さいときは、半行間を負にして行を line-height にする
 * (字は行の上下にはみ出す。XSL §4.5・CSS と同じ)。
 * 画像などの箱のある行は、箱の高さを下回らない
 */
const isTextOnlyLine = (all: Atom[]): boolean => !all.some(isInlineBox) && !all.some((a) => a.kind === 'ruby' || a.shift);

/**
 * 字ごとの書体の上下の高さに line-height を割り振る (fontLineMetrics): 字の上 = (行送り + (ascent − descent)) / 2、下 = (行送り − (ascent − descent)) / 2。
 * 上下の比率の違う書体が混ざると、行が広がる (広がるときだけ使う)。
 * 空白は字の形を持たないので、書体の混ざり方の判定に入れない (和文の書体だけを指定した行の空白が、欧文の書体で組まれても行を広げない)。
 * 横書きで、行内の箱 (画像・数式など) の無い行は、書体が 1 つでも書体の上下の高さで割り振る (字の基準線を下げないため。
 * 欧文の書体は ascent + descent が 1 em を超えるので、em の箱で割り振ると基準線が下がる)。広がらなくても使う。
 * 書体の上下の高さ (ascent・descent) は横書きの値なので、横書きの行だけに使う (縦書きの字は字面の中央にそろえる。
 * 縦書きで書体の混ざる行 (和文と回転した欧文) に使うと、行の中の字が block 方向へずれる)。
 * nominal (XSL-FO の互換モードだけ): ブロックの nominal-font (XSL 1.1 §5.5.7) の上下の高さの差 (ascent − descent。em の比) と、
 * ブロックの書体の指定。ブロックと同じ書体の指定の字は、字形を取った書体によらず、この値で割り振る。和文と欧文の混じる行でも
 * 上と下の最大が同じ書体の値になるので、行送りが line-height を超えず、欧文だけの行の基線も和文の行と同じ位置になる
 * (アンテナハウスの公開の見本との比較による。同じ大きさの字の行は、和文だけ・欧文だけ・混在のどれも行送りが line-height で、
 * 表の同じ行の和文のセルと欧文のセルの基線がそろう)。書体の指定の違う字 (fo:inline の font-family) は、その字の書体の値のまま。
 * 使わない行なら undefined
 */
function fontLineMetricsOf(
  all: Atom[],
  wm: WritingMode,
  sc: LineScan,
  leading: number,
  strut: { above: number; below: number } | undefined,
  nominal?: { family: string; diff: number },
): LineMetrics | undefined {
  if (wm !== 'horizontal-tb') return undefined;
  const fontGlyphs = all.filter((a) => a.st.fontLineMetrics && a.kind === 'glyph' && a.g && !a.isSpace);
  if (!fontGlyphs.length) return undefined;
  const textOnly = !all.some(isInlineBox);
  if (all.some((a) => a.kind === 'ruby' || (a.shift && a.kind !== 'box') || (a.kind === 'glyph' && !a.st.fontLineMetrics))) return undefined;
  if (!(textOnly || new Set(fontGlyphs.map((a) => a.g!.font)).size > 1)) return undefined;
  // 字は書体の上下の高さだけで決める (em の箱の値と混ぜない)。行内の箱 (画像など) はその上下
  let A = 0;
  let B = 0;
  for (const a of all) {
    if (!isInlineBox(a)) continue;
    const ab = atomAboveBelow(a, wm);
    A = Math.max(A, ab.above + (a.shift ?? 0));
    B = Math.max(B, ab.below - (a.shift ?? 0));
  }
  for (const a of fontGlyphs) {
    // nominal: ブロックと同じ書体の指定の字は、字形を取った書体 (欧文の代わりの書体など) ではなく、ブロックの nominal-font の上下で割り振る
    const d = (nominal && (a.st.fontFamilySpec ?? a.st.fontFamily) === nominal.family ? nominal.diff : a.g!.font.ascentMinusDescent) * a.st.fontSize;
    const l = lineHeightOf(a.st);
    A = Math.max(A, (l + d) / 2);
    B = Math.max(B, (l - d) / 2);
  }
  if (!(A + B > sc.above + sc.below + leading + (textOnly ? -1e-6 : 1e-6) || (strut && (strut.above > A + 1e-6 || strut.below > B + 1e-6)))) return undefined;
  // 支柱 (CSS 2.1 §10.8.1): 行の高さは支柱の上下を下回らない
  if (strut) {
    A = Math.max(A, strut.above);
    B = Math.max(B, strut.below);
  }
  // 最小・最大はループで取る (Math.min(...配列) は、要素を 1 つずつ引数に積むので、1 行に 12 万を超える字があるとスタックを使い切る)
  let asc = 0;
  let desc = 0;
  for (const a of fontGlyphs) {
    asc = Math.max(asc, (a.g!.font.ascent ?? a.g!.font.baselineRatio) * a.st.fontSize);
    desc = Math.max(desc, (a.g!.font.descent ?? 1 - a.g!.font.baselineRatio) * a.st.fontSize);
  }
  return { above: A, below: B, em: A + B, leading: 0, rubyExtent: sc.rubyExtent, base: A + B, topLeading: Math.max(A - asc, 0), bottomLeading: Math.max(B - desc, 0) };
}

/**
 * 持ち上げた (baseline-shift) 字: その字の行の高さの領域 (字の上下 + 字の line-height による半行間) をずらして、
 * 行の上下からはみ出す分だけ行を広げる (line-height-shift-adjustment="consider-shifts"。XSL §7.16.5 は、ずらした字の上端・下端を
 * 行の高さに入れるとだけ定める。半行間まで含めるので、上付き・下付きの行は、ずらした量だけ広がる)
 */
function addShiftedExtents(sc: LineScan, all: Atom[], wm: WritingMode, leading: number): void {
  let extraAbove = 0;
  let extraBelow = 0;
  for (const a of all) {
    if (!a.shift || a.kind === 'box' || a.st.lineHeightShiftAdjustment === 'disregard-shifts') continue;
    const ab = atomAboveBelow(a, wm);
    const half = (lineHeightOf(a.st) - (ab.above + ab.below)) / 2;
    extraAbove = Math.max(extraAbove, ab.above + half + a.shift - (sc.above + leading / 2));
    extraBelow = Math.max(extraBelow, ab.below + half - a.shift - (sc.below + leading / 2));
  }
  sc.above += extraAbove;
  sc.below += extraBelow;
}

/**
 * 行の上端 (基線から above + 半行間) と下端は、needA・needB (支柱と、字ごとの行内の箱) を下回らない (CSS 2.1 §10.8.1)。
 * 足りなければ上下に広げた LineMetrics を返す
 */
function finishLine(sc: LineScan, lead: number, needA: number, needB: number): LineMetrics {
  const { above, below, rubyExtent } = sc;
  const em = above + below;
  const ea = Math.max(0, needA - (above + lead / 2));
  const eb = Math.max(0, needB - (below + lead / 2));
  if (ea > 1e-9 || eb > 1e-9) return { above: above + ea, below: below + eb, em: em + ea + eb, leading: lead, rubyExtent, base: em + ea + eb + lead };
  return { above, below, em, leading: lead, rubyExtent, base: em + lead };
}

// ───────────────────────── CSS モデル ─────────────────────────

/**
 * CSS の行の高さ (CSS 2.1 §10.8)。primaryFontMetrics のブロック (HTML の入力) と、互換の印の無いブロック。
 *  - 字の上下は em の箱 (atomAboveBelow)。代わりの書体の字は、最初に使える書体の上下 (primaryRatio)。
 *    line-height: normal の字が代わりの書体で組まれたときは、その書体の上下も行の上下の下限に入れる (CSS Inline 3 §5.3。Atom.fallbackNormal)
 *  - 行には支柱 (strut) があり、行の上下は支柱と、字ごとの行内の箱 (字の上下 + その字の半行間) を下回らない
 *  - 字だけの行の半行間は負にもなる (行の高さは line-height そのもの。primaryFontMetrics のときだけ)
 *  - HTML の横書きの行 (fontBaseline): 基線の位置が書体ごとに違うので、字の大きさの箱の最大と line-height の最大からではなく、
 *    行の中身ごとの上下を基線でそろえて囲む (layoutBoundsMetrics)
 */
function lineMetricsCss(pl: PositionedLine, wm: WritingMode, fallback: ResolvedStyle, nominalRatio?: number, strut?: { above: number; below: number }): LineMetrics {
  const { atoms, all } = lineAtoms(pl, fallback);
  const onlyStrut = strutOnlyLine(all, strut);
  if (onlyStrut) return onlyStrut;
  const sc = scanLine(all, wm, !!fallback.primaryFontMetrics);
  const byLineHeight = lineHeightStrategyMetrics(atoms, sc);
  if (byLineHeight) return byLineHeight;
  raiseToStrutForBoxLine(sc, all, wm, fallback, nominalRatio);
  // CSS (primaryFontMetrics) の字だけの行: 半行間は負にもなる (CSS 2.1 §10.8.1)
  const leading = isTextOnlyLine(all) && fallback.primaryFontMetrics ? sc.lh - (sc.above + sc.below) : Math.max(sc.lh - (sc.above + sc.below), 0);
  const byFont = fontLineMetricsOf(all, wm, sc, leading, strut);
  if (byFont) return byFont;
  // HTML の横書きの行 (fontBaseline): 行内の箱ごとの上下 (A′・D′) を基線でそろえて囲む
  const byBounds = fallback.fontBaseline && wm === 'horizontal-tb' ? layoutBoundsMetrics(all, sc, leading, strut, nominalRatio) : undefined;
  if (byBounds) return byBounds;
  addShiftedExtents(sc, all, wm, leading);
  // 半行間はそのまま使う (負なら負のまま: 字だけの行の行の高さは line-height)
  const lead = leading;
  // 行の上端・下端は、支柱と、字ごとの行内の箱を下回らない (CSS 2.1 §10.8.1)。
  // 行内の箱の上下は、その字の上下に、その字の line-height による半行間を足したもの (字の大きさが違えば半行間も違う: 小さい字に同じ
  // line-height を当てると、箱が行の上下へはみ出し、行が広がる)。ずらした字は、ずらしを数えない (disregard-shifts) ときだけここで、ずらす前の位置で数える
  let needA = strut?.above ?? 0;
  let needB = strut?.below ?? 0;
  // line-height: normal の字が代わりの書体で組まれたとき: その書体の上下 (ascent・descent と行間) も行の上下の下限に入れる
  // (CSS Inline 3 §5.3: 計算値が normal の行内の箱の layout bounds は、中の字すべてを、いちばん高い A からいちばん深い D まで囲む。
  // normal でない字は、最初に使える書体の値と line-height だけで決まり、fallbackNormal は付かない。値は fontManager.ts の normalLineBounds)。
  // ずらした字 (上付き・下付き) は、ずらした位置で数える (ずらしを数えない指定 (disregard-shifts) のときは、ずらす前の位置)
  if (fallback.primaryFontMetrics) {
    for (const a of all) {
      if (!a.fallbackNormal || (a.kind !== 'glyph' && a.kind !== 'ruby')) continue;
      const sh = a.shift && a.st.lineHeightShiftAdjustment !== 'disregard-shifts' ? a.shift : 0;
      needA = Math.max(needA, a.fallbackNormal.above + sh);
      needB = Math.max(needB, a.fallbackNormal.below - sh);
    }
  }
  if (fallback.primaryFontMetrics && wm === 'horizontal-tb') {
    for (const a of all) {
      if (a.kind !== 'glyph' || (a.st.lineHeightQuirk && a.isSpace)) continue;
      if (a.shift && a.st.lineHeightShiftAdjustment !== 'disregard-shifts') continue;
      const ab = atomAboveBelow(a, wm);
      const half = (lineHeightOf(a.st) - (ab.above + ab.below)) / 2;
      needA = Math.max(needA, ab.above + half);
      needB = Math.max(needB, ab.below + half);
    }
  }
  return finishLine(sc, lead, needA, needB);
}

/**
 * HTML の横書きの行 (ResolvedStyle.fontBaseline) の行の高さ: 行の中身それぞれの、基線の上・下の広がり (layout bounds) を基線でそろえ、
 * いちばん高い上端からいちばん深い下端までを行の箱にする (CSS 2.1 §10.8・§10.8.1、CSS Inline 3 §5.1・§5.3)。
 *  - 字・ルビ・leader・改行の印: その字の書式の最初に使える書体の A・D (em の箱に置き換えた値。atomAboveBelow) に、その書式の line-height に
 *    なるだけの半行間を上下に足す (A′ = A + L/2、D′ = D + L/2、L = line-height − (A + D)。L は負にもなる)。
 *    書体が違えば A′・D′ の割合が違うので、別の書体を名指しした inline (本文の中の等幅の字など) のある行は、line-height より高くなる
 *    (§10.8.1 の例・Inline 3 §5.3)。ずらした字 (上付き・下付き・vertical-align の長さ) は、ずらした位置で数える
 *    (ずらしを数えない指定 (disregard-shifts) のときは、ずらす前の位置)
 *  - line-height: normal の字が代わりの書体で組まれたとき: その書体の上下 (Atom.fallbackNormal。Inline 3 §5.3)
 *  - 罫線・余白つきの inline の両端の空き: その inline の支柱 (最初に使える書体の A′・D′。中の字が代わりの書体だけでも数える。Inline 3 §5.3)
 *  - 画像・inline-block などの箱: 箱の上下 (margin の箱。line-height は使わない。CSS 2.1 §10.8.1)。ずらした箱は、ずらした位置
 *  - 支柱 (strut): ブロックの最初に使える書体と line-height (CSS 2.1 §10.8.1)
 * 返す値は、行の上端から基線までが above + leading / 2、基線から下端までが below + leading / 2 になるように分ける
 * (leading は、行の中の line-height の最大から字の大きさの箱を引いた量。ルビを行間に収める計算に使う)。
 * どの中身も数えない行 (支柱が無く、中身も無い) は undefined
 */
function layoutBoundsMetrics(all: Atom[], sc: LineScan, leading: number, strut: { above: number; below: number } | undefined, nominalRatio: number | undefined): LineMetrics | undefined {
  let A = strut?.above ?? -Infinity;
  let D = strut?.below ?? -Infinity;
  const add = (above: number, below: number) => {
    A = Math.max(A, above);
    D = Math.max(D, below);
  };
  for (const a of all) {
    // 互換モード (Quirks Mode §3.3): 中身の無い行内の箱と空白だけの字は数えない (scanLine と同じ)
    if (a.st.lineHeightQuirk && ((a.kind === 'box' && a.idMark) || (a.kind === 'glyph' && a.isSpace))) continue;
    if (a.kind === 'box') {
      if (a.frameOpen || a.frameClose) {
        const fs = a.st.fontSize;
        const r = a.primaryRatio ?? nominalRatio ?? DEFAULT_BASELINE_RATIO;
        const half = (lineHeightOf(a.st) - fs) / 2;
        add(r * fs + half, (1 - r) * fs + half);
      } else if (a.box && (a.box.above || a.box.below)) {
        const sh = a.shift ?? 0;
        add(a.box.above + sh, a.box.below - sh);
      }
      continue;
    }
    const ab = atomAboveBelow(a, 'horizontal-tb');
    const half = (lineHeightOf(a.st) - (ab.above + ab.below)) / 2;
    const sh = a.shift && a.st.lineHeightShiftAdjustment !== 'disregard-shifts' ? a.shift : 0;
    add(ab.above + half + sh, ab.below + half - sh);
    if (a.fallbackNormal && (a.kind === 'glyph' || a.kind === 'ruby')) add(a.fallbackNormal.above + sh, a.fallbackNormal.below - sh);
  }
  if (!Number.isFinite(A) || !Number.isFinite(D)) return undefined;
  const above = A - leading / 2;
  const below = D - leading / 2;
  return { above, below, em: above + below, leading, rubyExtent: sc.rubyExtent, base: A + D };
}

// ───────────────────────── 互換 (AH) モデル ─────────────────────────

/**
 * XSL-FO の入力の行の高さ (互換モードの挙動)。
 *  - boxLineHalfLeading: 画像などの箱のある行も、ブロックの字の矩形 (nominal-requested-line-rectangle。XSL §4.5) を行の高さに含め、
 *    ブロックの半行間を上下に空ける
 *  - blockLeadingMaxHeight: ブロックの字より大きい字のある max-height の行は、字の大きさの箱を囲み、ブロックの半行間を上下に足す
 *  - fontLineMetrics (字ごと): 書体の ascent・descent に line-height を割り振る。nominalDiff があれば、ブロックと同じ書体の指定の字は
 *    ブロックの nominal-font の上下で割り振る (和文と欧文の混じる行を広げない。fontLineMetricsOf の説明)
 */
function lineMetricsAh(pl: PositionedLine, wm: WritingMode, fallback: ResolvedStyle, nominalRatio?: number, strut?: { above: number; below: number }, nominalDiff?: number): LineMetrics {
  const { atoms, all } = lineAtoms(pl, fallback);
  const onlyStrut = strutOnlyLine(all, strut);
  if (onlyStrut) return onlyStrut;
  const sc = scanLine(all, wm, false);
  const byLineHeight = lineHeightStrategyMetrics(atoms, sc);
  if (byLineHeight) return byLineHeight;
  const hasBox = all.some((a) => isInlineBox(a) && a.box);
  // 画像などの箱のある行も、ブロックの字の矩形 (nominal-requested-line-rectangle。XSL §4.5) を行の高さに含める
  // (字の無い画像だけの行で、画像の下にブロックの字の下がりの分を空ける)
  if (fallback.boxLineHalfLeading && wm === 'horizontal-tb' && hasBox) {
    // ブロックの字の矩形は、ブロックの nominal-font の上下 (行の中の字の書体ではない)
    const br = nominalRatio ?? all.find((a) => a.kind === 'glyph' && a.g)?.g?.font.baselineRatio ?? DEFAULT_BASELINE_RATIO;
    sc.above = Math.max(sc.above, br * fallback.fontSize);
    sc.below = Math.max(sc.below, (1 - br) * fallback.fontSize);
  }
  // blockLeadingMaxHeight だけのブロック (boxLineHalfLeading 無し) は CSS と同じ支柱を持つ
  if (!fallback.boxLineHalfLeading) raiseToStrutForBoxLine(sc, all, wm, fallback, nominalRatio);
  // ブロックの字より大きい字のある max-height の行は、字の大きさの箱を囲み、ブロックの半行間を上下に足す (§4.5)
  if (
    fallback.blockLeadingMaxHeight &&
    (fallback.lineStackingStrategy ?? 'max-height') === 'max-height' &&
    wm === 'horizontal-tb' &&
    atoms.some((a) => a.kind === 'glyph' && !a.isSpace && !a.shift && a.st.fontSize > fallback.fontSize + 0.01)
  ) {
    const half = Math.max(lineHeightOf(fallback) - fallback.fontSize, 0) / 2;
    const br = all.find((a) => a.kind === 'glyph' && a.g)?.g?.font.baselineRatio ?? DEFAULT_BASELINE_RATIO;
    let A = br * fallback.fontSize;
    let B = (1 - br) * fallback.fontSize;
    for (const a of all) {
      if (a.kind === 'break' || (a.kind === 'box' && (a.frameOpen || a.frameClose)) || (a.kind === 'glyph' && a.isSpace)) continue;
      const ab = atomAboveBelow(a, wm);
      const sh = a.shift ?? 0;
      A = Math.max(A, ab.above + sh);
      B = Math.max(B, ab.below - sh);
    }
    return { above: A, below: B, em: A + B, leading: 2 * half, rubyExtent: sc.rubyExtent, base: A + B + 2 * half };
  }
  // 字だけの行で line-height が字の上下より小さいときは、半行間を負にして行を line-height にする (boxLineHalfLeading のとき)
  const leading = isTextOnlyLine(all) && fallback.boxLineHalfLeading ? sc.lh - (sc.above + sc.below) : Math.max(sc.lh - (sc.above + sc.below), 0);
  const byFont = fontLineMetricsOf(all, wm, sc, leading, strut, nominalDiff === undefined ? undefined : { family: fallback.fontFamilySpec ?? fallback.fontFamily, diff: nominalDiff });
  if (byFont) return byFont;
  addShiftedExtents(sc, all, wm, leading);
  // 行の高さを超える箱 (画像など) のある行も、ブロックの半行間 (line-height と字の大きさの差の半分) を上下に空ける
  // (XSL §4.5 の max-height: 行の矩形の上下に半行間。画像の枠は前の行から半行間だけ下がる)
  const minLeading = fallback.boxLineHalfLeading && hasBox ? Math.max(lineHeightOf(fallback) - fallback.fontSize, 0) : 0;
  const lead = Math.max(leading, minLeading);
  return finishLine(sc, lead, strut?.above ?? 0, strut?.below ?? 0);
}
