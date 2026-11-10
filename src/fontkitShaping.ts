/**
 * fontkitShaping — @pdf-lib/fontkit で、インド系の用字 (デーヴァナーガリーなど) とタイ文字を組めるようにする。
 *
 * fontkit の書体の layout (字の並びを字形の並びにする入口。測るとき (measurer.ts)・字形の番号と位置を決めるとき (areaResources.ts)・
 * 輪郭で描くとき (canvasRenderer.ts)・pdf-lib の埋め込みは、どれもここを通る) を 1 回差し替えて、次の 14 個を補う。
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
 * 5. 字形が「最初に作られたときの字」を覚えていて、後の文字列の音節の分け方が、それまでに組んだ文字列で変わる
 *    fontkit は、字形の番号ごとに字形のオブジェクトを 1 つ作って覚え (getGlyph)、そのとき渡された「この字形が表す字」(codePoints) も
 *    一緒に覚える。文字列を字形の並びにするとき (glyphsForString) も、覚えているオブジェクトをそのまま返すので、字形が最初に
 *    別の字から作られていると (書体の ccmp が、合成済みの字を「基底の字 + 記号」の字形に分けたときなど)、表す字が食い違う。
 *    インド系の整形は、音節に分けるときの字の種類 (子音・ヌクタ・母音記号…) を、この「表す字」から引くので、種類を取り違える。
 *    例 (Noto Sans Bengali): ড় (U+09DC。書体が ড + ヌクタの字形に分ける) を 1 度組むと、ヌクタの字形が U+09DC を表すと覚えられ、
 *    その後の ড় (U+09A1 U+09BC。NFC はこちら) + 母音記号で、ヌクタが子音と見なされて、母音記号の前に点線の丸 (U+25CC) が入る。
 *    文字列の字から、字形ごとに正しい「表す字」を持たせた並びを作って渡す (glyphsWithOwnCodePoints)。
 *
 * 6. 記号を載せる規則で、相手の字形に記号の位置が無いと落ちる (マラヤーラムの「子音 + ヴィラーマ」などが組めない)
 *    記号を基底の字・合字・別の記号に載せる規則 (GPOS の MarkBasePos・MarkLigPos・MarkMarkPos) は、相手の字形ごとに、記号の種類の数だけ
 *    位置 (Anchor) の表への参照を持ち、その参照は NULL でもよい (OpenType 仕様「GPOS」の BaseRecord・ComponentRecord・Mark2Record:
 *    「offsets may be NULL」。その種類の記号を載せる位置が無い字形)。fontkit は NULL を確かめずに座標を読むので、
 *    「Cannot read properties of null (reading 'xCoordinate')」で落ち、その字の並びを測れず描けない (Noto Sans Malayalam・Noto Serif Malayalam:
 *    ട് (U+0D1F U+0D4D) のような「子音 + ヴィラーマ」で終わる並び・സ്ത のような結合子音の多く)、Noto Sans Khmer の NIKAHIT U+17C6・下に付く子音)。位置が無いときは、その規則を
 *    当たらなかったことにして、次の規則へ進む (HarfBuzz も同じ: Anchor が見つからなければ、その副表は当たらない)。
 *
 * 7. 汎用の整形 (UniversalShaper。シンハラ文字など) で、音節に入らない字形があると落ちる
 *    fontkit の汎用の整形は、字の並びを音節に分け、音節に入った字形にだけ情報 (種類・音節の番号) を付ける。音節の形に合わない字
 *    (ヴィラーマの後ろの ZWJ、母音記号の後ろのヴィラーマ = 2 つ・3 つに分かれる母音記号 U+0DDA・U+0DDD を分けた後ろの部分) は
 *    どの音節にも入らず、後の並べ替えが、その字形の情報を読もうとして「Cannot read properties of null (reading 'syllable')」で落ちる
 *    (Noto Sans Sinhala・Noto Serif Sinhala: කෝ・කේ、ක්‍ (子音 + ヴィラーマ + ZWJ)、ර්‍ක (レパヤ))。
 *    音節に入らなかった字形は、前の音節に入れる。ヴィラーマの後ろの ZWJ は、次の子音と結合を作る指定 (Unicode 標準 12 章 Sinhala:
 *    子音 + al-lakuna + ZWJ + 子音 = 結合子音・ラカーランサヤ・ヤンサヤ・レパヤ) なので、次の音節も 1 つの音節にまとめる
 *    (レパヤが、次の子音の後ろへ動き、子音との合字になる)。
 *
 * 8. 汎用の整形で、音節の先頭のレフを基底の字の後ろへ動かす処理が、字形の並びを壊す
 *    レフ (ラ + ヴィラーマ (+ ZWJ) が rphf で 1 つの字形になったもの) は、音節の最初の基底の字形の後ろへ動かす (Microsoft
 *    「Creating and supporting OpenType fonts for the Universal Shaping Engine」の Reordering: 「Repha … is reordered … to after the base」)。
 *    fontkit は、間の字形を前へ詰めた後に、詰める前の番号で字形を読んで差し込むので、基底の字形が消える・ほかの字形が 2 つになる・
 *    並びに穴が開いて落ちる (シンハラ文字のレパヤ ර්‍ක・ධර්‍ම)。fontkit の並べ替えの前に、こちらで正しく動かす。
 *
 * 9. ベンガル文字の、語の途中の音節の前に置く母音記号が、語頭の形になる
 *    ベンガル文字の書体は、前に置く母音記号 ে (E)・ৈ (AI) に、語頭の形 (前の字とつなぐ横線が左に出ない形) を持ち、機能 init で選ぶ
 *    (Microsoft「Developing OpenType Fonts for Bengali Script」の Features の Initial form: 「This feature is used to substitute
 *    initial forms of the vowels E and Ai … a glyph variant that does not have a connecting bar on the leading side」)。
 *    init を当てるのは語頭の音節だけだが、組版は字の単位 (音節) ごとに書体へ渡すので、fontkit は、どの音節も文字列の先頭 = 語頭と見て
 *    init を当て、語の途中の ে・ো などの頭の線が、前の字とつながらない。組版が、語の途中の単位に印 (NOT_WORD_INITIAL) を付けて渡すので、
 *    その印があるときは init を当てない。
 *
 * 10. 字形を「0 個の字形」に置き換える規則で、番号の無い字形が残る
 *    1 つの字形を字形の並びに置き換える規則 (GSUB の Multiple Substitution) で、並びの長さが 0 のもの (字形を消す) は、OpenType 仕様
 *    「GSUB」の Lookup type 2 が禁じている (「The use of multiple substitution for deletion of an input glyph is prohibited. The glyphCount
 *    value must always be greater than 0」) が、これを使う書体がある (Noto Serif Bengali: レフと前に置く母音記号 ি をまとめた字形を
 *    作った後、元のレフの字形を消す。র্কি・কার্তিক)。fontkit は、並びの最初の番号 (無い) を字形の番号にするので、番号の無い字形が
 *    並びに残り、その字の単位を描けない。番号の無い字形は描きようが無いので、並びから取り除く (HarfBuzz も、この規則を字形の削除として扱う)。
 *
 * 3・4 は仕様どおりの動きだが、ほかの用字の文書の結果を変えないよう、いまはインド系の用字とタイ文字 (LOOKUP_FIX_TEXT) と、
 * 東南アジア大陸部の用字・チベット文字 (LOOKUP_FIX_TEXT_SEA: ラオ・チベット・ミャンマー・クメール) を組むときだけ効かせる。
 *
 * ラオ・クメール・ミャンマー・チベット・モンゴルの字のために、次も補う (11 は LOOKUP_FIX_TEXT_SEA の字を含む文字列を組むときだけ):
 *
 * 2'. ラオ文字の SARA AM (U+0EB3) も、タイ文字と同じに NIGGAHITA (U+0ECD) と AA (U+0EB2) に分け、NIGGAHITA を前の上付きの記号の前へ移す
 *    (Microsoft「Developing OpenType Fonts for Lao Script」の Analyze Characters: 基底の字に声調記号が既にあれば、AM を分けて、
 *    NIGGAHITA を基底の字と声調記号の間へ並べ替える)。
 *
 * 11. 字形を増やす置き換えの後、増えた字形に同じ Lookup をもう 1 度当てて、終わらないことがある
 *    (Noto Sans Myanmar: 語頭の字形の前に空きの字形を入れる規則)。増えた分だけ先へ進める (patchGrowingSubstitution)。
 *    インド系の文字にも効かせて HarfBuzz と照合したが、結果は変わらなかった (要る例が無い) ので、範囲は広げていない。
 *
 * 12. fontkit が読めない Lookup (GSUB の Reverse Chaining Contextual Single Substitution) を持つ書体 (Noto Sans Mongolian) は、
 *    1 字も組めない。組むのに失敗した書体に限り、読めない Lookup を飛ばして組む (guardUnreadableLookups)。
 *
 * 13. ミャンマー文字は、fontkit に専用の整形が無く (既定の整形)、前に置く母音記号・メディアルの RA・キンジが元の字の順のままになる。
 *    書体に渡す前に音節の中を並べ替え (reorderMyanmar)、整形の機能 (MYANMAR_FEATURES) を足す。
 *
 * 14. クメール文字の文脈の合字 clig は、整形に必須の機能 (Microsoft「Developing OpenType Fonts for Khmer Script」の Features の表)。
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
/** 異体字セレクタ (U+FE00〜FE0F・U+E0100〜E01EF) */
const VARIATION_SELECTOR = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
/** タイ文字の SARA AM と、その前の上付きの記号の並び */
const THAI_SARA_AM = /([ัิ-ื็-๎]*)ำ/g;
/** ラオ文字の SARA AM (U+0EB3) と、その前の上付きの記号の並び (U+0EB1・U+0EB4〜0EB7・U+0EBB・U+0EC8〜0ECE。タイ文字の並びを U+0080 ずらしたもの) */
const LAO_SARA_AM = /([\u0EB1\u0EB4-\u0EB7\u0EBB\u0EC8-\u0ECE]*)\u0EB3/g;
/**
 * 上の 3・4・11 を効かせる文字列 (東南アジア大陸部の用字とチベット文字): ラオ文字 (U+0E80〜U+0EFF)・チベット文字 (U+0F00〜U+0FFF)・
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
/** いま組んでいる文字列で、上の 11 を効かせるか (LOOKUP_FIX_TEXT_SEA の字を含む文字列の layout の間だけ true) */
let seaFixActive = false;
/** いま組んでいる文字列で、上の 6〜8・10 を効かせるか (音節に分けて組む用字 = MAY_SYLLABLE_SHAPE の字を含む文字列の layout の間だけ true) */
let nullAnchorActive = false;
/** 上の 6: いま当てている規則 (Lookup の subtable) で、アンカーの無い組に当たった */
let anchorMissing = false;

/**
 * 上の 6: 記号を基底の字・合字・記号に付ける規則 (GPOS の Lookup の種類 4・5・6) で、その組のアンカーが無い (オフセットが NULL) とき、
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
    if ((seaFixActive || nullAnchorActive) && (!baseAnchor || !markRecord?.markAnchor)) {
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

const STRAY_PATCHED = Symbol.for('kumiori.fontkitUseStrayPatched');
/** prepareUseStrayFix を済ませた書体 */
const useStrayReady = new WeakSet<object>();
/** 汎用の整形 (UniversalShaper) が字形に付ける情報 (USEInfo)。インド系の整形 (IndicShaper) の情報は position も持つ */
type UseInfo = { category: string; syllableType: string; syllable: number; position?: unknown };
type UseGlyph = { codePoints: number[]; features: Record<string, boolean>; shaperInfo?: UseInfo | null };

/**
 * 汎用の整形で、どの音節にも入らなかった字形 (情報 shaperInfo が無い) を、前の音節に入れる (上の 7)。
 * ヴィラーマの後ろの ZWJ を入れたときは、次の音節も同じ音節にまとめる (子音 + ヴィラーマ + ZWJ + 子音 は 1 つの結合)。
 * 母音記号の後ろのヴィラーマを入れたときは、続く記号だけの音節 (アヌスヴァーラなど) をまとめる (කෝං。まとめないと、記号の前に点線の丸が入る)。
 * 手を入れた音節は、先頭の 3 つの字形にレフの機能 (rphf) を付け直す (fontkit は音節の長さで付けるので、後から入った字形に付いていない)
 */
function adoptUseStrays(glyphs: UseGlyph[]) {
  let stray = false;
  let use = false;
  for (const g of glyphs) {
    if (!g.shaperInfo) stray = true;
    else if ('syllableType' in g.shaperInfo && !('position' in g.shaperInfo)) use = true;
  }
  if (!stray || !use) return;
  let prev: UseInfo | null = null;
  /** 前の音節にまとめる途中の、次の音節の番号 (-1 = 次に出てきた音節、0 = まとめない) と、まとめる先 */
  let joinFrom = 0;
  let joinTo: UseInfo | null = null;
  /** 次の音節が「基底の字の無い音節」(記号だけ。broken_cluster) のときだけまとめる */
  let joinMarksOnly = false;
  const touched = new Set<number>();
  for (const g of glyphs) {
    const info = g.shaperInfo;
    if (info) {
      if (joinTo && joinFrom === -1) joinFrom = joinMarksOnly && info.syllableType !== 'broken_cluster' ? 0 : info.syllable;
      if (joinTo && info.syllable === joinFrom) {
        info.syllable = joinTo.syllable;
        info.syllableType = joinTo.syllableType;
      } else {
        joinFrom = 0;
        joinTo = null;
      }
      prev = info;
      continue;
    }
    if (!prev) continue; // 文字列の先頭の、音節に入らない字形: 入れる先が無い (下で 1 字の音節にする)
    const cp = g.codePoints[0];
    g.shaperInfo = { category: cp === 0x0dca ? 'H' : 'O', syllableType: prev.syllableType, syllable: prev.syllable };
    touched.add(prev.syllable);
    if (cp === 0x200d && prev.category === 'H') {
      joinFrom = -1;
      joinTo = prev;
      joinMarksOnly = false;
    } else if (cp === 0x0dca) {
      // 母音記号の後ろのヴィラーマ (分かれる母音記号の後ろの部分) で音節が切れた: 続くアヌスヴァーラ・ヴィサルガ (記号だけの音節) も同じ音節
      joinFrom = -1;
      joinTo = prev;
      joinMarksOnly = true;
    }
    prev = g.shaperInfo;
  }
  // 先頭に残った字形は、それだけの音節にする (並べ替えの対象にならない種類)
  let n = 0;
  for (const g of glyphs) if (!g.shaperInfo) g.shaperInfo = { category: 'O', syllableType: 'independent_cluster', syllable: --n };
  let syllable = Number.NaN;
  let k = 0;
  for (const g of glyphs) {
    const info = g.shaperInfo!;
    if (info.syllable !== syllable) {
      syllable = info.syllable;
      k = 0;
    }
    if (touched.has(syllable) && k++ < 3) g.features.rphf = true;
  }
}

/**
 * 汎用の整形で、音節の先頭のレフ (rphf で置き換わった字形。種類 R) を、音節の最初の基底の字形の後ろ (置き換わらずに残ったヴィラーマが
 * 先にあれば、その前) へ動かす (上の 8)。動かした字形は種類を「その他」にして、fontkit の並べ替えが、もう 1 度動かさないようにする
 */
function reorderUseReph(glyphs: Array<UseGlyph & { isLigated?: boolean }>) {
  for (let start = 0; start < glyphs.length; ) {
    const first = glyphs[start].shaperInfo;
    let end = start + 1;
    while (end < glyphs.length && glyphs[end].shaperInfo?.syllable === first?.syllable) end++;
    if (first && first.category === 'R' && 'syllableType' in first && !('position' in first) && end - start > 1) {
      for (let i = start + 1; i < end; i++) {
        const info = glyphs[i].shaperInfo;
        const halant = info?.category === 'H' && !glyphs[i].isLigated;
        if (info?.category === 'B' || info?.category === 'GB' || halant) {
          const to = halant ? i - 1 : i;
          if (to > start) glyphs.splice(to, 0, glyphs.splice(start, 1)[0]);
          break;
        }
      }
      first.category = 'O';
    }
    start = end;
  }
}

/**
 * 書体ごとに 1 回: 字形を置き換える処理 (GSUB) の各段階の前に、音節に入らなかった字形を前の音節に入れ (上の 7)、
 * 並べ替えの直前の段階の後で、レフを動かす (上の 8)。処理の原型に 1 回だけ。
 * 音節に分ける段階・並べ替えの段階は fontkit の中の関数で、差し替えられないので、その前後に呼ばれる applyFeatures で行う
 */
function prepareUseStrayFix(font: FkFont) {
  if (useStrayReady.has(font)) return;
  useStrayReady.add(font);
  type Proto = { applyFeatures?: (this: unknown, features: unknown, glyphs: UseGlyph[], positions: unknown) => unknown; [STRAY_PATCHED]?: boolean };
  // GSUB・GPOS の処理に共通の原型 (OTProcessor) の applyFeatures (GPOS の処理は、自分の applyFeatures からこれを呼ぶ)
  let proto = Object.getPrototypeOf(font._layoutEngine?.engine?.GSUBProcessor ?? null) as Proto | null;
  let top: Proto | null = null;
  for (; proto; proto = Object.getPrototypeOf(proto) as Proto | null) if (Object.prototype.hasOwnProperty.call(proto, 'applyFeatures')) top = proto;
  if (!top || top[STRAY_PATCHED] || typeof top.applyFeatures !== 'function') return;
  const applyFeatures = top.applyFeatures;
  top.applyFeatures = function (features, glyphs, positions) {
    if (!nullAnchorActive || positions || !Array.isArray(glyphs)) return applyFeatures.call(this, features, glyphs, positions);
    adoptUseStrays(glyphs);
    const r = applyFeatures.call(this, features, glyphs, positions);
    // 並べ替えの直前の段階 (結合子音の機能 cjct を含む組) の後で、レフを動かす
    if (Array.isArray(features) && features.includes('cjct') && features.includes('rkrf')) reorderUseReph(glyphs);
    // 番号の無い字形 (上の 10) を取り除く
    for (let i = glyphs.length - 1; i >= 0; i--) if ((glyphs[i] as { id?: number }).id === undefined) glyphs.splice(i, 1);
    return r;
  };
  top[STRAY_PATCHED] = true;
}

/**
 * 文字列 → 書体の字形の並び (fontkit の glyphsForString と同じ、字と字形の 1 対 1 の対応) で、字形ごとに「その字形が表す字」を
 * 文字列の字のとおりに持たせたもの (上の 5)。異体字セレクタ (字と組で cmap を引く) を含む文字列・字形を引けないときは null (fontkit に任せる)。
 * 字形そのもの (輪郭・送り) は fontkit が覚えているものを使い、表す字 (codePoints) だけを上書きした写しを渡す
 */
function glyphsWithOwnCodePoints(font: unknown, text: string): unknown[] | null {
  if (VARIATION_SELECTOR.test(text)) return null;
  const f = font as { glyphForCodePoint?: (cp: number) => object | null };
  if (typeof f.glyphForCodePoint !== 'function') return null;
  const out: unknown[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const g = f.glyphForCodePoint(cp);
    if (!g) return null;
    out.push(Object.create(g, { codePoints: { value: [cp], writable: true, enumerable: true, configurable: true } }));
  }
  return out;
}

/**
 * 「語頭の形にしない」ことを表す、機能の名前の代わりの印 (上の 9)。組版 (inlineFlatten.ts) が、語の途中のベンガル文字の字の単位の書式に足し、
 * 測るとき・字形を決めるとき・描くときの layout に、ほかの機能と同じ道で届く。書体の機能の名前 (英数字 4 字) とは重ならない
 */
export const NOT_WORD_INITIAL = '-init';

/** 機能の指定に NOT_WORD_INITIAL があれば、それを「init を当てない」に読み替えたもの (無ければ、そのまま) */
function resolveWordInitial(features: unknown): unknown {
  if (Array.isArray(features)) {
    if (!features.includes(NOT_WORD_INITIAL)) return features;
    return { ...Object.fromEntries(features.filter((f) => f !== NOT_WORD_INITIAL).map((f) => [f, true])), init: false };
  }
  if (!features || typeof features !== 'object' || !(NOT_WORD_INITIAL in features)) return features;
  const { [NOT_WORD_INITIAL]: _, ...rest } = features as Record<string, boolean>;
  return { ...rest, init: false };
}

/** 上の 11: いま当てている GSUB の規則の入れ子の深さ (文脈の規則・拡張の規則が、中で別の規則を当てる) */
let gsubDepth = 0;

/**
 * 上の 11: 字形を増やす置き換え (GSUB の Multiple Substitution。じかに当てるものと、文脈の規則が中で当てるもの) の後、fontkit は
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
 * 上の 12: fontkit が読めない Lookup (GSUB の Reverse Chaining Contextual Single Substitution = 種類 8。fontkit の表の定義の誤りで、
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

/** fontkit の書体の layout を差し替える (上の 1〜14。fontkit の書体の原型に 1 回だけ) */
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
        // 12: 読めない Lookup のある書体は、代わりを置いて組み直す
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
      // 14: クメール文字の文脈の合字 clig は、整形に必須の機能 (Microsoft「Developing OpenType Fonts for Khmer Script」の Features の表で
      // Required。子音と母音記号 AA をつないだ字形「បា」など。HarfBuzz も、合字の指定によらず当てる)。fontkit のインド系の整形も clig を
      // 当てるが、呼び出し側が任意の合字を切る指定 (clig: false) を渡すと当たらないので、その指定を外す
      const f = rest[0];
      if (f && typeof f === 'object' && !Array.isArray(f) && (f as { clig?: boolean }).clig === false) {
        const { clig: _clig, ...others } = f as Record<string, boolean>;
        rest[0] = others;
      }
    }
    const wasAnchor = nullAnchorActive;
    patchNullAnchor((this as FkFont)._layoutEngine?.engine?.GPOSProcessor);
    prepareUseStrayFix(this as FkFont);
    nullAnchorActive = true;
    if (setRuntime) g.regeneratorRuntime = syllableRuntime;
    try {
      const glyphs = glyphsWithOwnCodePoints(this, text) ?? text;
      const features = resolveWordInitial(rest[0]);
      try {
        return layout.call(this, glyphs, features, ...rest.slice(1));
      } catch (e) {
        if (guardUnreadableLookups(this as FkFont)) return layout.call(this, glyphs, features, ...rest.slice(1));
        throw e;
      }
    } finally {
      if (setRuntime) delete g.regeneratorRuntime;
      lookupFixActive = wasActive;
      seaFixActive = wasSea;
      nullAnchorActive = wasAnchor;
    }
  };
  proto[SHAPING_PATCHED] = true;
}
