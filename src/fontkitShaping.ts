/**
 * fontkitShaping — @pdf-lib/fontkit で、インド系の用字 (デーヴァナーガリーなど) とタイ文字を組めるようにする。
 *
 * fontkit の書体の layout (字の並びを字形の並びにする入口。測るとき (measurer.ts)・字形の番号と位置を決めるとき (areaResources.ts)・
 * 輪郭で描くとき (canvasRenderer.ts)・pdf-lib の埋め込みは、どれもここを通る) を 1 回差し替えて、次の 4 つを補う。
 * どれも、当てはまる字を含む文字列を組むときだけ働く (ほかの文字列は、これまでと同じ道を通り、同じ結果になる)。
 *
 * 1. 音節に分ける処理が落ちる (デーヴァナーガリーなどが組めない)
 *    fontkit は、インド系の用字 (IndicShaper: デーヴァナーガリー・ベンガル・タミルなど) と汎用の整形 (UniversalShaper: バリ・ジャワなど) で、
 *    字の並びを音節に分けるのに StateMachine.match を使う。これは Babel が変換したジェネレータで、大域の名前 regeneratorRuntime を
 *    参照するが、fontkit はそれを持ち込まない (配布物の UMD 版・ES 版のどちらも同じ)。そのため、これらの用字の字を組むと
 *    「regeneratorRuntime is not defined」で落ち、字を測れず描けない。
 *    StateMachine は fontkit の外から届かない (モジュールの中の変数) ので、layout の呼び出しの間だけ、大域に最小の代わり (syllableRuntime) を置く。
 *    layout は同期の処理で、ジェネレータもその中で使い切るので、呼び出しが終われば大域を元に戻せる (ほかのコードからは見えない。
 *    代わりは match に要る分しか持たないので、大域に置いたままにすると、regeneratorRuntime の有無を見て動きを変える別のコードを壊しうる)。
 *    大域に regeneratorRuntime が既にあれば (アプリが regenerator-runtime を読み込んでいる)、それを使う。
 *
 * 2. タイ文字の SARA AM (U+0E33) の前に声調記号などがあると、記号の重なる順が逆になる
 *    SARA AM は、丸 (NIKHAHIT U+0E4D) と SARA AA (U+0E32) の 2 つの字形に分け、丸が基底の字のすぐ上、声調記号がその上に来るように
 *    並べ替えてから書体に渡す (Microsoft「Developing OpenType Fonts for Thai Script」の Invalid Combining Marks の表の AM:
 *    「The AM character needs to be broken into two glyphs and some reordering might be required so that the ring is the base glyph」。
 *    HarfBuzz のタイ文字の整形も同じ: 丸を、前にある上付きの記号 (U+0E31・U+0E34〜0E37・U+0E47〜0E4E) の並びの前へ移す)。
 *    fontkit にはタイ文字用の整形が無く、書体の ccmp が SARA AM を分けるだけなので、丸が声調記号の上に載ってしまう。
 *    並べ替えるのは書体に渡す文字列だけで、組版の字 (GlyphArea の text。PDF の文字の取り出し) は元のまま。
 *
 * 3. 記号を選んで飛ばす指定 (mark filtering set) が効かない
 *    OpenType の Lookup の lookupFlag の USE_MARK_FILTERING_SET (0x0010) は、「指定した集合 (GDEF の MarkGlyphSets) に無い記号の字形を
 *    すべて飛ばして」規則を当てる指定 (OpenType 仕様「OpenType Layout Common Table Formats」の Lookup table)。fontkit の
 *    GlyphIterator.shouldIgnore はこれを見ないので、間に別の記号が挟まると文脈の規則が当たらない (Noto Sans Thai: 上に伸びる字
 *    ป・ฝ・ฟ + 下の母音 + 声調記号 で、声調記号が左へ寄せた字形に替わらない)。shouldIgnore に、この指定を足す。
 *
 * 4. 前の文脈 (backtrack) が 2 字形以上の規則が当たらない
 *    文脈の連鎖の規則 (Chained Sequence Context) の前の文脈の並びは、「入力の並びのすぐ前の字形から、前へ向かう順」に書かれている
 *    (OpenType 仕様「OpenType Layout Common Table Formats」の Chained Sequence Context: backtrack の並びは、字の並びと逆の順)。
 *    fontkit は、これを字の並びの順のまま比べるので、前の文脈が 2 字形以上の規則が当たらない (Noto Sans Thai: 上に伸びる字 ป・ฝ・ฟ +
 *    下の母音 + 声調記号 で、声調記号が、字の上に伸びた部分を避けて左へ寄せた字形に替わらない)。比べる前に、並びを逆にする。
 *
 * 3・4 は仕様どおりの動きだが、ほかの用字の文書の結果を変えないよう、いまはインド系の用字とタイ文字 (LOOKUP_FIX_TEXT) と、
 * 東南アジア大陸部の用字・チベット文字 (LOOKUP_FIX_TEXT_SEA: ラオ・チベット・ミャンマー・クメール) を組むときだけ効かせる。
 *
 * ラオ・クメール・ミャンマー・チベット・モンゴルの字のために、次も補う (5・6 は LOOKUP_FIX_TEXT_SEA の字を含む文字列を組むときだけ):
 *
 * 2'. ラオ文字の SARA AM (U+0EB3) も、タイ文字と同じに NIGGAHITA (U+0ECD) と AA (U+0EB2) に分け、NIGGAHITA を前の上付きの記号の前へ移す
 *    (Microsoft「Developing OpenType Fonts for Lao Script」の Analyze Characters: 基底の字に声調記号が既にあれば、AM を分けて、
 *    NIGGAHITA を基底の字と声調記号の間へ並べ替える)。
 *
 * 5. 記号を付ける規則 (GPOS の Lookup の種類 4・5・6) で、組のアンカーが無い (オフセットが NULL) と落ちる
 *    アンカーの表へのオフセットは NULL でありうる (OpenType 仕様「GPOS」の Mark-to-Base Attachment Positioning の BaseRecord:
 *    baseAnchorOffsets は NULL でもよい)。fontkit は無いアンカーの座標を読んで落ち、その字を測れず描けない
 *    (Noto Sans Khmer の NIKAHIT U+17C6・下に付く子音)。無い組には当てず、同じ Lookup の次の subtable を試す (patchNullAnchor)。
 *
 * 6. 字形を増やす置き換えの後、増えた字形に同じ Lookup をもう 1 度当てて、終わらないことがある
 *    (Noto Sans Myanmar: 語頭の字形の前に空きの字形を入れる規則)。増えた分だけ先へ進める (patchGrowingSubstitution)。
 *
 * 7. fontkit が読めない Lookup (GSUB の Reverse Chaining Contextual Single Substitution) を持つ書体 (Noto Sans Mongolian) は、
 *    1 字も組めない。組むのに失敗した書体に限り、読めない Lookup を飛ばして組む (guardUnreadableLookups)。
 *
 * 8. ミャンマー文字は、fontkit に専用の整形が無く (既定の整形)、前に置く母音記号・メディアルの RA・キンジが元の字の順のままになる。
 *    書体に渡す前に音節の中を並べ替え (reorderMyanmar)、整形の機能 (MYANMAR_FEATURES) を足す。
 *
 * 9. クメール文字の文脈の合字 clig は、整形に必須の機能 (Microsoft「Developing OpenType Fonts for Khmer Script」の Features の表)。
 *    呼び出し側の「任意の合字を切る」指定 (clig: false) で止まらないようにする。
 */

import { isMyanmarBase, isMyanmarDependent } from './orthographicSyllable';

/** 差し替え済みの印 (fontkit の原型に付ける。pdfLibPatches.ts と同じ決まり) */
const SHAPING_PATCHED = Symbol.for('kumiori.fontkitShapingPatched');
const ITERATOR_PATCHED = Symbol.for('kumiori.fontkitMarkSetPatched');
const MATCH_PATCHED = Symbol.for('kumiori.fontkitBacktrackPatched');
const ANCHOR_PATCHED = Symbol.for('kumiori.fontkitNullAnchorPatched');
const GROW_PATCHED = Symbol.for('kumiori.fontkitGrowPatched');

/**
 * fontkit が音節に分けて組む用字の字を含みうるか: インド系・東南アジアの用字のブロック (U+0900 デーヴァナーガリー〜U+1CFF ヴェーダの拡張、
 * U+A800〜U+ABFF) と、第 1 面の古い用字など (U+10000〜U+1BFFF)。広めに取ってある (当たっても、代わりを置いて戻す手間が増えるだけ)
 */
const MAY_SYLLABLE_SHAPE = /[ऀ-᳿ꠀ-꯿\u{10000}-\u{1BFFF}]/u;
/** 上の 3・4 を効かせる文字列: インド系の用字 (U+0900〜U+0DFF) とタイ文字 (U+0E00〜U+0E7F) を含む */
const LOOKUP_FIX_TEXT = /[ऀ-๿]/;
/** タイ文字の SARA AM と、その前の上付きの記号の並び */
const THAI_SARA_AM = /([ัิ-ื็-๎]*)ำ/g;
/** ラオ文字の SARA AM (U+0EB3) と、その前の上付きの記号の並び (U+0EB1・U+0EB4〜0EB7・U+0EBB・U+0EC8〜0ECE。タイ文字の並びを U+0080 ずらしたもの) */
const LAO_SARA_AM = /([\u0EB1\u0EB4-\u0EB7\u0EBB\u0EC8-\u0ECE]*)\u0EB3/g;
/**
 * 上の 3・4・5・6 を効かせる文字列 (東南アジア大陸部の用字とチベット文字): ラオ文字 (U+0E80〜U+0EFF)・チベット文字 (U+0F00〜U+0FFF)・
 * ミャンマー文字 (U+1000〜U+109F と拡張 U+A9E0〜U+A9FF・U+AA60〜U+AA7F)・クメール文字 (U+1780〜U+17FF)
 */
const LOOKUP_FIX_TEXT_SEA = /[\u0E80-\u0FFF\u1000-\u109F\u1780-\u17FF\uA9E0-\uA9FF\uAA60-\uAA7F]/;
/** クメール文字 (U+1780〜U+17FF) を含む */
const KHMER_TEXT = /[\u1780-\u17FF]/;
/** ミャンマー文字 (U+1000〜U+109F と拡張 A・B) を含む */
const MYANMAR_TEXT = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/;
/**
 * ミャンマー文字の整形で当てる書体の機能 (Microsoft「Developing OpenType Fonts for Myanmar Script」の Shaping Engine の節:
 * 基本の機能 rphf・pref・blwf・pstf と、表示の形の機能 pres・abvs・blws・psts)。fontkit の既定の整形は、これらを当てない
 */
const MYANMAR_FEATURES = ['rphf', 'pref', 'blwf', 'pstf', 'pres', 'abvs', 'blws', 'psts', 'dist', 'abvm', 'blwm'] as const;

/**
 * ミャンマー文字の音節の中の字を、書体に渡す順に並べ替える (字の数は変えない)。
 * Microsoft「Developing OpenType Fonts for Myanmar Script」の Shaping Engine の節の並べ替え (HarfBuzz のミャンマー文字の整形も同じ):
 *  - 前に置く母音記号 (U+1031・U+1084) と、メディアルの RA (U+103C。基底の字を囲む) を、基底の字の前へ (母音記号が先)
 *  - キンジ (U+1004・U+101B・U+105A のどれか + ASAT U+103A + VIRAMA U+1039。次の子音の上に載る) を、基底の字 (次の子音) のすぐ後ろへ
 *  - 下の母音記号 (U+102F・U+1030・U+1058・U+1059) の後ろのアヌスヴァーラ (U+1032・U+1036) を、下の母音記号の前へ
 * 音節は、基底の字 (キンジがあればその後ろの子音) と、VIRAMA で積む子音、その後ろの「付く字」の並び。文法に合わない並び
 * (HarfBuzz は点線の丸を補う) も同じ決まりで並べ替えるだけで、点線の丸は補わない
 */
export function reorderMyanmar(text: string): string {
  const n = text.length;
  let out = '';
  for (let i = 0; i < n; ) {
    const c = text.charCodeAt(i);
    if (!isMyanmarBase(c)) {
      out += text[i++];
      continue;
    }
    const kinzi = (c === 0x1004 || c === 0x101b || c === 0x105a) && text.charCodeAt(i + 1) === 0x103a && text.charCodeAt(i + 2) === 0x1039 && isMyanmarBase(text.charCodeAt(i + 3)) ? 3 : 0;
    const base = i + kinzi;
    let j = base + 1;
    for (;;) {
      const d = text.charCodeAt(j);
      if (d === 0x1039 && isMyanmarBase(text.charCodeAt(j + 1))) j += 2;
      else if (isMyanmarDependent(d)) j++;
      else break;
    }
    // 並べる位置: 前の母音記号・メディアルの RA・(基底の字・キンジ)・主・下の記号の前・下・下の記号の後ろ
    const pre: string[] = ['', ''];
    const post: string[] = ['', '', '', ''];
    let pos = 0;
    let last: { list: string[]; k: number } = { list: post, k: 0 };
    for (let k = base + 1; k < j; k++) {
      const d = text.charCodeAt(k);
      const below = d === 0x102f || d === 0x1030 || d === 0x1058 || d === 0x1059;
      const anusvara = d === 0x1032 || d === 0x1036;
      let at: { list: string[]; k: number };
      if (d === 0x103c) at = { list: pre, k: 1 };
      else if (d === 0x1031 || d === 0x1084) at = { list: pre, k: 0 };
      else if (d === 0xfe00) at = last;
      else if (pos === 0 && below) at = { list: post, k: (pos = 2) };
      else if (pos === 2 && anusvara) at = { list: post, k: 1 };
      else if (pos === 2 && below) at = { list: post, k: 2 };
      else if (pos === 2) at = { list: post, k: (pos = 3) };
      else at = { list: post, k: pos };
      at.list[at.k] += text[k];
      last = at;
    }
    out += pre[0] + pre[1] + text[base] + text.slice(i, base) + post[0] + post[1] + post[2] + post[3];
    i = j;
  }
  return out;
}

/**
 * StateMachine.match が使う、Babel の regenerator の実行時の部品の代わり。match の中身は「次の状態の番号を _context.next に入れて値を返す」
 * 「終わりで _context.stop() を呼ぶ」だけなので、それに要る分 (mark は関数をそのまま返す。wrap は、状態 {prev, next, stop()} を持って
 * inner を呼ぶ反復子を返す) だけを持つ
 */
const syllableRuntime = {
  mark: <T>(f: T): T => f,
  wrap(inner: (ctx: { prev: number; next: number; stop(): void }) => unknown) {
    let done = false;
    const ctx = {
      prev: 0,
      next: 0,
      stop() {
        done = true;
      },
    };
    const it = {
      next(): { done: boolean; value: unknown } {
        if (done) return { done: true, value: undefined };
        const value = inner(ctx);
        return done ? { done: true, value: undefined } : { done: false, value };
      },
      [Symbol.iterator]() {
        return it;
      },
    };
    return it;
  },
};

type Coverage = { version: number; glyphs?: number[]; rangeRecords?: Array<{ start: number; end: number }> };
type LookupFlags = { flags?: { useMarkFilteringSet?: boolean } };
type Lookup = { flags?: LookupFlags; markFilteringSet?: number | null };
type LayoutTable = { lookupList?: { length: number; get(i: number): Lookup | undefined } };
type GlyphIteratorProto = { shouldIgnore?: (this: { options?: object }, glyph: { id: number; isMark: boolean }) => unknown; [ITERATOR_PATCHED]?: boolean };
type Processor = { applyLookups(lookups: unknown[], glyphs: unknown[], positions: unknown[]): void; glyphIterator?: object };
type GposProto = {
  applyAnchor?: (this: unknown, markRecord: { markAnchor?: unknown } | null, baseAnchor: unknown, baseGlyphIndex: number) => unknown;
  applyLookup?: (this: unknown, lookupType: number, table: unknown) => unknown;
  [ANCHOR_PATCHED]?: boolean;
};
type GsubProto = {
  applyLookup?: (this: { glyphs?: unknown[]; glyphIterator?: { index: number } }, lookupType: number, table: unknown) => unknown;
  [GROW_PATCHED]?: boolean;
};
type ProcessorProto = { match?: (this: unknown, sequenceIndex: number, sequence: unknown[], ...rest: unknown[]) => unknown; [MATCH_PATCHED]?: boolean };
type FkFont = {
  GSUB?: LayoutTable;
  GPOS?: LayoutTable;
  GDEF?: { markGlyphSetsDef?: { coverage?: Coverage[] } | null };
  _layoutEngine?: { engine?: { GSUBProcessor?: Processor | null; GPOSProcessor?: Processor | null } };
};

/** Lookup の flags (GlyphIterator が options として受け取るもの) → 飛ばさない記号の字形の番号の集合 */
const markSets = new WeakMap<object, Set<number>>();
/** prepareLookupFixes を済ませた書体 */
const lookupFixReady = new WeakSet<object>();
/** いま組んでいる文字列で、上の 3・4 を効かせるか (layout の呼び出しの間だけ true) */
let lookupFixActive = false;
/** いま組んでいる文字列で、上の 5・6 を効かせるか (LOOKUP_FIX_TEXT_SEA の字を含む文字列の layout の間だけ true) */
let seaFixActive = false;
/** 上の 5: いま当てている規則 (Lookup の subtable) で、アンカーの無い組に当たった */
let anchorMissing = false;

/**
 * 上の 5: 記号を基底の字・合字・記号に付ける規則 (GPOS の Lookup の種類 4・5・6) で、その組のアンカーが無い (オフセットが NULL) とき、
 * fontkit は無いアンカーの座標を読んで落ちる。無い組には規則を当てず (位置を変えない)、同じ Lookup の次の subtable を試す
 * (OpenType 仕様「GPOS」の BaseRecord・ComponentRecord・Mark2Record: アンカーの表へのオフセットは NULL でありうる。
 * その種類の記号を付ける点が無いことを表す)。
 * GPOS の処理 (GPOSProcessor) の原型に 1 回だけ
 */
function patchNullAnchor(gpos: object | null | undefined) {
  let gp = Object.getPrototypeOf(gpos ?? null) as GposProto | null;
  while (gp && !Object.prototype.hasOwnProperty.call(gp, 'applyAnchor')) gp = Object.getPrototypeOf(gp) as GposProto | null;
  if (!gp || gp[ANCHOR_PATCHED] || typeof gp.applyAnchor !== 'function' || typeof gp.applyLookup !== 'function') return;
  const applyAnchor = gp.applyAnchor;
  const applyLookup = gp.applyLookup;
  gp.applyAnchor = function (markRecord, baseAnchor, baseGlyphIndex) {
    if (seaFixActive && (!baseAnchor || !markRecord?.markAnchor)) {
      anchorMissing = true;
      return undefined;
    }
    return applyAnchor.call(this, markRecord, baseAnchor, baseGlyphIndex);
  };
  gp.applyLookup = function (lookupType, table) {
    anchorMissing = false;
    const r = applyLookup.call(this, lookupType, table);
    if (!anchorMissing) return r;
    anchorMissing = false;
    return false;
  };
  gp[ANCHOR_PATCHED] = true;
}

/**
 * 書体ごとに 1 回: GSUB・GPOS の Lookup のうち USE_MARK_FILTERING_SET のものの記号の集合を作り (上の 3)、
 * 規則を当てる処理 (OTProcessor) の match と、字形をたどる反復子 (GlyphIterator) の shouldIgnore を差し替える (上の 3・4。原型に 1 回だけ)
 */
function prepareLookupFixes(font: FkFont) {
  if (lookupFixReady.has(font)) return;
  lookupFixReady.add(font);
  try {
    patchNullAnchor(font._layoutEngine?.engine?.GPOSProcessor);
    patchGrowingSubstitution(font._layoutEngine?.engine?.GSUBProcessor);
  } catch {
    // 処理を取り出せない書体は、これまでと同じ
  }
  try {
    const proc = font._layoutEngine?.engine?.GSUBProcessor ?? font._layoutEngine?.engine?.GPOSProcessor;
    if (!proc) return;
    // 4: 前の文脈 (sequenceIndex が負) の並びは、すぐ前の字形から前へ向かう順なので、字の並びの順に直してから比べる
    let pp = Object.getPrototypeOf(proc) as ProcessorProto | null;
    while (pp && !Object.prototype.hasOwnProperty.call(pp, 'match')) pp = Object.getPrototypeOf(pp) as ProcessorProto | null;
    if (pp && !pp[MATCH_PATCHED] && typeof pp.match === 'function') {
      const match = pp.match;
      pp.match = function (sequenceIndex, sequence, ...rest) {
        return match.call(this, sequenceIndex, lookupFixActive && sequenceIndex < 0 && sequence.length > 1 ? [...sequence].reverse() : sequence, ...rest);
      };
      pp[MATCH_PATCHED] = true;
    }
    // 3: 記号の集合
    const coverages = font.GDEF?.markGlyphSetsDef?.coverage;
    if (!coverages?.length) return;
    let any = false;
    for (const table of [font.GSUB, font.GPOS]) {
      const list = table?.lookupList;
      for (let i = 0; list && i < list.length; i++) {
        const lookup = list.get(i);
        const cov = lookup?.flags?.flags?.useMarkFilteringSet && lookup.markFilteringSet != null ? coverages[lookup.markFilteringSet] : undefined;
        if (!lookup?.flags || !cov) continue;
        const set = new Set<number>();
        for (const g of cov.glyphs ?? []) set.add(g);
        for (const r of cov.rangeRecords ?? []) for (let g = r.start; g <= r.end; g++) set.add(g);
        markSets.set(lookup.flags, set);
        any = true;
      }
    }
    if (!any) return;
    // GlyphIterator の原型は、処理が applyLookups で作る反復子から取る (空の並びで 1 度呼ぶ)
    proc.applyLookups([], [], []);
    const proto = Object.getPrototypeOf(proc.glyphIterator ?? null) as GlyphIteratorProto | null;
    if (!proto || proto[ITERATOR_PATCHED] || typeof proto.shouldIgnore !== 'function') return;
    const shouldIgnore = proto.shouldIgnore;
    proto.shouldIgnore = function (glyph) {
      if (shouldIgnore.call(this, glyph)) return true;
      if (!lookupFixActive || !glyph.isMark || !this.options) return false;
      const set = markSets.get(this.options);
      return !!set && !set.has(glyph.id);
    };
    proto[ITERATOR_PATCHED] = true;
  } catch {
    // 表を読めない書体は、これまでと同じ
  }
}

/** 上の 6: いま当てている GSUB の規則の入れ子の深さ (文脈の規則・拡張の規則が、中で別の規則を当てる) */
let gsubDepth = 0;

/**
 * 上の 6: 字形を増やす置き換え (GSUB の Multiple Substitution。じかに当てるものと、文脈の規則が中で当てるもの) の後、fontkit は
 * 増えた字形へ進んで同じ Lookup をもう 1 度当てる。置き換えた結果に元の字形が含まれる規則 (字形の前に空きの字形を入れる規則など) では、
 * これが終わらず止まる。Lookup は、置き換えた字形を飛ばして次へ進む決まり (OpenType 仕様「GSUB」の Table organization の節:
 * 「次」の字形へ進むとき、その Lookup の処理に加わった字形 (置き換えた字形と、入力の並びの字形) をすべて飛ばす) なので、
 * 増えた分だけ先へ進める。GSUB の処理の原型に 1 回だけ
 */
function patchGrowingSubstitution(gsub: object | null | undefined) {
  let gp = Object.getPrototypeOf(gsub ?? null) as GsubProto | null;
  while (gp && !Object.prototype.hasOwnProperty.call(gp, 'applyLookup')) gp = Object.getPrototypeOf(gp) as GsubProto | null;
  if (!gp || gp[GROW_PATCHED] || typeof gp.applyLookup !== 'function') return;
  const applyLookup = gp.applyLookup;
  gp.applyLookup = function (lookupType, table) {
    if (!seaFixActive || !this.glyphs || !this.glyphIterator) return applyLookup.call(this, lookupType, table);
    const before = this.glyphs.length;
    gsubDepth++;
    let r: unknown;
    try {
      r = applyLookup.call(this, lookupType, table);
    } finally {
      gsubDepth--;
    }
    const grown = this.glyphs.length - before;
    if (gsubDepth === 0 && r && grown > 0) this.glyphIterator.index += grown;
    return r;
  };
  gp[GROW_PATCHED] = true;
}

/** 読めない Lookup の代わりを置いた書体 */
const lookupGuarded = new WeakSet<object>();
/**
 * 上の 7: fontkit が読めない Lookup (GSUB の Reverse Chaining Contextual Single Substitution = 種類 8。fontkit の表の定義の誤りで、
 * 読むと「Not a fixed size」で落ちる) を持つ書体は、その Lookup を使う機能 (Noto Sans Mongolian の calt・rclt) のある文字列を 1 つも組めない
 * (欧字も)。組むのに失敗した書体に限り、読めない Lookup を「何も置き換えない Lookup」として読む (その規則だけが当たらない)。
 * 代わりを置いたら true (呼び出し側が、もう 1 度組む)
 */
function guardUnreadableLookups(font: FkFont): boolean {
  if (lookupGuarded.has(font)) return false;
  lookupGuarded.add(font);
  let any = false;
  try {
    for (const table of [font.GSUB, font.GPOS]) {
      const list = table?.lookupList as (LayoutTable['lookupList'] & { get(i: number): unknown }) | undefined;
      if (!list || typeof list.get !== 'function') continue;
      const get = list.get.bind(list);
      list.get = (i: number) => {
        try {
          return get(i);
        } catch {
          return { lookupType: 1, flags: {}, subTables: [] } as never;
        }
      };
      any = true;
    }
  } catch {
    return false;
  }
  return any;
}

/** fontkit の書体の layout を差し替える (上の 1〜4。fontkit の書体の原型に 1 回だけ) */
export function patchFontkitShaping(fk: unknown) {
  type Proto = { layout?: (this: unknown, text: unknown, ...rest: unknown[]) => unknown; [SHAPING_PATCHED]?: boolean };
  // layout を持つ原型 (TTFFont。WOFF・WOFF2 の書体はそれを継ぐ)
  let proto = Object.getPrototypeOf(fk ?? null) as Proto | null;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'layout')) proto = Object.getPrototypeOf(proto) as Proto | null;
  if (!proto || proto[SHAPING_PATCHED] || typeof proto.layout !== 'function') return;
  const layout = proto.layout;
  const g = globalThis as { regeneratorRuntime?: unknown };
  proto.layout = function (text0, ...rest) {
    if (typeof text0 !== 'string' || !MAY_SYLLABLE_SHAPE.test(text0)) {
      try {
        return layout.call(this, text0, ...rest);
      } catch (e) {
        // 7: 読めない Lookup のある書体は、代わりを置いて組み直す
        if (guardUnreadableLookups(this as FkFont)) return layout.call(this, text0, ...rest);
        throw e;
      }
    }
    let text = text0.includes('ำ') ? text0.replace(THAI_SARA_AM, 'ํ$1า') : text0;
    if (text.includes('\u0EB3')) text = text.replace(LAO_SARA_AM, '\u0ECD$1\u0EB2');
    const setRuntime = !('regeneratorRuntime' in g);
    const wasActive = lookupFixActive;
    const wasSea = seaFixActive;
    if (LOOKUP_FIX_TEXT.test(text) || LOOKUP_FIX_TEXT_SEA.test(text)) {
      prepareLookupFixes(this as FkFont);
      lookupFixActive = true;
      seaFixActive = LOOKUP_FIX_TEXT_SEA.test(text);
    }
    if (MYANMAR_TEXT.test(text)) {
      text = reorderMyanmar(text);
      // 機能の指定 (字形の機能の名前 → 有効か) に、ミャンマー文字の整形の機能を足す (呼び出し側が明示したものはそのまま)
      const f = rest[0];
      if (f === undefined || f === null) rest[0] = Object.fromEntries(MYANMAR_FEATURES.map((x) => [x, true]));
      else if (Array.isArray(f)) rest[0] = [...f, ...MYANMAR_FEATURES.filter((x) => !f.includes(x))];
      else if (typeof f === 'object') rest[0] = { ...Object.fromEntries(MYANMAR_FEATURES.map((x) => [x, true])), ...f };
    }
    if (KHMER_TEXT.test(text)) {
      // 9: クメール文字の文脈の合字 clig は、整形に必須の機能 (Microsoft「Developing OpenType Fonts for Khmer Script」の Features の表で
      // Required。子音と母音記号 AA をつないだ字形「បា」など。HarfBuzz も、合字の指定によらず当てる)。fontkit のインド系の整形も clig を
      // 当てるが、呼び出し側が任意の合字を切る指定 (clig: false) を渡すと当たらないので、その指定を外す
      const f = rest[0];
      if (f && typeof f === 'object' && !Array.isArray(f) && (f as { clig?: boolean }).clig === false) {
        const { clig: _clig, ...others } = f as Record<string, boolean>;
        rest[0] = others;
      }
    }
    if (setRuntime) g.regeneratorRuntime = syllableRuntime;
    try {
      try {
        return layout.call(this, text, ...rest);
      } catch (e) {
        if (guardUnreadableLookups(this as FkFont)) return layout.call(this, text, ...rest);
        throw e;
      }
    } finally {
      if (setRuntime) delete g.regeneratorRuntime;
      lookupFixActive = wasActive;
      seaFixActive = wasSea;
    }
  };
  proto[SHAPING_PATCHED] = true;
}
