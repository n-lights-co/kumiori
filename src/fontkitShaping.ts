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
 * 3・4 は仕様どおりの動きだが、ほかの用字の文書の結果を変えないよう、いまはインド系の用字とタイ文字 (LOOKUP_FIX_TEXT) を組むときだけ効かせる。
 */

/** 差し替え済みの印 (fontkit の原型に付ける。pdfLibPatches.ts と同じ決まり) */
const SHAPING_PATCHED = Symbol.for('kumiori.fontkitShapingPatched');
const ITERATOR_PATCHED = Symbol.for('kumiori.fontkitMarkSetPatched');
const MATCH_PATCHED = Symbol.for('kumiori.fontkitBacktrackPatched');

/**
 * fontkit が音節に分けて組む用字の字を含みうるか: インド系・東南アジアの用字のブロック (U+0900 デーヴァナーガリー〜U+1CFF ヴェーダの拡張、
 * U+A800〜U+ABFF) と、第 1 面の古い用字など (U+10000〜U+1BFFF)。広めに取ってある (当たっても、代わりを置いて戻す手間が増えるだけ)
 */
const MAY_SYLLABLE_SHAPE = /[ऀ-᳿ꠀ-꯿\u{10000}-\u{1BFFF}]/u;
/** 上の 3・4 を効かせる文字列: インド系の用字 (U+0900〜U+0DFF) とタイ文字 (U+0E00〜U+0E7F) を含む */
const LOOKUP_FIX_TEXT = /[ऀ-๿]/;
/** タイ文字の SARA AM と、その前の上付きの記号の並び */
const THAI_SARA_AM = /([ัิ-ื็-๎]*)ำ/g;

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

/**
 * 書体ごとに 1 回: GSUB・GPOS の Lookup のうち USE_MARK_FILTERING_SET のものの記号の集合を作り (上の 3)、
 * 規則を当てる処理 (OTProcessor) の match と、字形をたどる反復子 (GlyphIterator) の shouldIgnore を差し替える (上の 3・4。原型に 1 回だけ)
 */
function prepareLookupFixes(font: FkFont) {
  if (lookupFixReady.has(font)) return;
  lookupFixReady.add(font);
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
    if (typeof text0 !== 'string' || !MAY_SYLLABLE_SHAPE.test(text0)) return layout.call(this, text0, ...rest);
    const text = text0.includes('ำ') ? text0.replace(THAI_SARA_AM, 'ํ$1า') : text0;
    const setRuntime = !('regeneratorRuntime' in g);
    const wasActive = lookupFixActive;
    if (LOOKUP_FIX_TEXT.test(text)) {
      prepareLookupFixes(this as FkFont);
      lookupFixActive = true;
    }
    if (setRuntime) g.regeneratorRuntime = syllableRuntime;
    try {
      return layout.call(this, text, ...rest);
    } finally {
      if (setRuntime) delete g.regeneratorRuntime;
      lookupFixActive = wasActive;
    }
  };
  proto[SHAPING_PATCHED] = true;
}
