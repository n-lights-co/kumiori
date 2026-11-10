/**
 * arabicMarks — アラビア文字の結合文字 (母音記号など) の並びを、描くための順に並べ替える。
 *
 * UTR #53 (Unicode Arabic Mark Rendering) の AMTRA (Arabic Mark Transient Reordering Algorithm。§3.2):
 *  1. 並びを NFD にする (結合文字を正準結合クラス (ccc) の順に並べる)
 *  2. 続く結合文字 (ccc が 0 でない字) の並び S ごとに、
 *     a. シャッダ (ccc = 33) を S の先頭へ移す
 *     b. ccc = 230 の字の並びが MCM (Modifier Combining Mark) で始まれば、その MCM の並びを S の先頭 (シャッダより前) へ移す
 *     c. ccc = 220 の字の並びが MCM で始まれば、その MCM の並びを S の先頭 (ccc = 230 の MCM・シャッダより前) へ移す
 * 書体は、基底の字に近い順 (内から外) に結合文字を重ねる。正準順 (NFC・NFD) ではファトハ (ccc = 30) がシャッダ (ccc = 33) の前に来るので、
 * そのまま書体に渡すと、シャッダがファトハの上に載る (ファトハがシャッダの下に来て、カスラと読める)。並べ替えた並びは、元の並びと正準等価。
 * 基底の字は分解しない (UTR #53 §3.2 の実装上の注記: 合成済みの字 (أ など) に戻してよい。基底の字を分解しなければ同じ結果になる)
 */

/** MCM (PropList.txt の Modifier_Combining_Mark。Unicode 18.0) のうち、ccc = 230 の字 */
const MCM_230 = new Set([0x0654, 0x0658, 0x06dc, 0x06e7, 0x06e8, 0x08ca, 0x08cb, 0x08cd, 0x08ce, 0x08f3, 0x10ef9]);
/** MCM のうち、ccc = 220 の字 */
const MCM_220 = new Set([0x0655, 0x06e3, 0x08cf, 0x08d3, 0x10ef4, 0x10ef6]);
const SHADDA = 0x0651;
/** 並べ替えが要りうる並び: シャッダか MCM を含む */
const NEEDS_REORDER = /[ّٕۣٔ٘ۜۧۨ࣊࣋࣍-࣏࣓ࣳ\u{10EF4}\u{10EF6}\u{10EF9}]/u;
/** 結合文字 (Mn・Mc・Me) の 2 字以上の並び */
const MARK_RUN = /\p{M}{2,}/gu;

const nfd = (s: string) => s.normalize('NFD');
/** 2 つの結合文字 a・b の並びを NFD にすると、順が入れ替わるか (どちらも ccc が 0 でなく、ccc(a) > ccc(b) のとき) */
const swaps = (a: string, b: string) => nfd(a + b) !== nfd(a) + nfd(b);

/**
 * 字の正準結合クラスの区分: 0 (ccc = 0)・220・230・それ以外の 0 でない値 (1)。
 * 正準結合クラスの表を持たずに、正規化 (String.prototype.normalize) の並べ替えから求める: U+0345 (ccc = 240) の後ろに置いて前へ出れば
 * 0 < ccc < 240、U+0334 (ccc = 1) の前に置いて後ろへ回れば ccc > 1。220・230 は、U+0323 (ccc = 220)・U+0300 (ccc = 230) とどちらの順でも
 * 入れ替わらないこと
 */
const cccKind = new Map<string, 0 | 1 | 220 | 230>();
function kindOf(ch: string): 0 | 1 | 220 | 230 {
  let k = cccKind.get(ch);
  if (k === undefined) {
    if (!swaps('ͅ', ch) && !swaps(ch, '̴')) k = 0;
    else if (!swaps('̀', ch) && !swaps(ch, '̀')) k = 230;
    else if (!swaps('̣', ch) && !swaps(ch, '̣')) k = 220;
    else k = 1;
    cccKind.set(ch, k);
  }
  return k;
}

/** 続く結合文字 (ccc が 0 でない字) の並び S (NFD の順) を、AMTRA の順にする */
function reorderRun(S: string[]): string[] {
  const moved = new Set<number>();
  const take = (kind: 220 | 230, mcm: Set<number>): string[] => {
    const start = S.findIndex((c) => kindOf(c) === kind);
    const out: string[] = [];
    for (let k = start; k >= 0 && k < S.length && mcm.has(S[k].codePointAt(0)!); k++) {
      out.push(S[k]);
      moved.add(k);
    }
    return out;
  };
  const m230 = take(230, MCM_230);
  const m220 = take(220, MCM_220);
  const shadda: string[] = [];
  S.forEach((c, k) => {
    if (c.codePointAt(0) === SHADDA) {
      shadda.push(c);
      moved.add(k);
    }
  });
  return [...m220, ...m230, ...shadda, ...S.filter((_, k) => !moved.has(k))];
}

/** 文字列の中の、アラビア文字の結合文字の並びを、描くための順 (UTR #53) にする。並べ替えの要らない文字列は、そのまま返す */
export function reorderArabicMarks(text: string): string {
  if (!NEEDS_REORDER.test(text)) return text;
  return text.replace(MARK_RUN, (run) => {
    if (!NEEDS_REORDER.test(run)) return run;
    // ccc = 0 の結合文字 (U+034F CGJ など) で区切って、区切りごとに並べ替える (CGJ は並べ替えを止めるために使う。UTR #53 §4.2)
    const out: string[] = [];
    let S: string[] = [];
    const flush = () => {
      if (S.length > 1 && S.some((c) => NEEDS_REORDER.test(c))) out.push(...reorderRun([...nfd(S.join(''))]));
      else out.push(...S);
      S = [];
    };
    for (const c of run) {
      if (kindOf(c) === 0) {
        flush();
        out.push(c);
      } else S.push(c);
    }
    flush();
    return out.join('');
  });
}
