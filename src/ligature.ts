/**
 * ligature — 書体の合字の表 (OpenType の GSUB の LookupType 4: Ligature Substitution) を読む。
 * 字の並びを 1 つの字形にする規則 (最初の字形 + 続く字形の並び → 合字の字形) を、有効な機能 (liga・clig・dlig・hlig) の分だけ集める。
 * 語をアイコンに置き換える書体 (home → 家の絵。Material Icons・Ligature Symbols など) のように、欧文の字の 2〜4 字に収まらない並び
 * (長い語、数字や _ を含む名前) を合字にする書体を見分け、その並びを引くのに使う (inlineFlatten.ts の ligatureUnits)。
 * 表の形は OpenType の仕様の GSUB の章
 * (https://learn.microsoft.com/en-us/typography/opentype/spec/gsub の「Lookup type 4 subtable: ligature substitution」、2026-11-10 取得):
 * 合字の組 (LigatureSet) は最初の字形ごとにあり、その中の合字は「優先する順」に並ぶ (同じ字で始まる長い並びを先に置く)。
 * 組む側は、その順に見て最初に合ったものを使う
 */
import type { LoadedFont } from './fontManager';
import { withLayoutBudget } from './fontSanity';

/** 合字の機能 (CSS Fonts 4 §6.4: 標準の合字 liga・clig、任意の合字 dlig、歴史的な合字 hlig) */
export const LIGATURE_FEATURES: readonly string[] = ['liga', 'clig', 'dlig', 'hlig'];

export interface LigatureTable {
  /** 最初の字形の番号 → 続く字形の番号の並び (書体の表の順 = 優先する順) */
  byFirst: Map<number, number[][]>;
  /** いちばん長い並びの字の数 */
  maxLen: number;
  /**
   * 欧文の字 (A〜Z・a〜z と合字の字 U+FB00〜U+FB04) の 2〜4 字の並びに収まらない合字を持つか (5 字以上の並び、数字・記号などを含む並び)。
   * 持たない書体は、従来どおり、欧文の字の並びだけを書体の整形で確かめる
   */
  extended: boolean;
}

type FkCoverage = { version: number; glyphs?: number[]; rangeRecords?: Array<{ start: number; end: number; startCoverageIndex: number }> };
type FkLigature = { compCount: number; components: number[] };
type FkSubTable = { lookupType?: number; extension?: FkSubTable; coverage?: FkCoverage; ligatureSets?: { length: number; get(i: number): FkLigature[] } };
type FkGsub = {
  featureList?: Array<{ tag: string; feature: { lookupListIndexes: number[] } }>;
  lookupList?: { length: number; get(i: number): { lookupType: number; subTables: FkSubTable[] } };
};

const cache = new WeakMap<object, Map<string, LigatureTable | null>>();

/**
 * Coverage の表が覆う字形の番号 (Coverage Index の順)。使うのは Coverage Index が count より小さい分だけ (LigatureSet の数) なので、
 * その先は数えない。範囲 (format 2 の RangeRecord) は 65536 字形まで広げられ、副表ごとに範囲の全体を広げると、
 * 副表の数 × 範囲の数 × 65536 の手間になった (200 の副表 × 2000 の範囲で 40 秒を超えた)。同じ Coverage は 1 度だけ広げる (memo)
 */
function coverageGlyphs(c: FkCoverage, count: number, memo: Map<FkCoverage, { count: number; out: number[] }>, work: { left: number }): number[] {
  const hit = memo.get(c);
  if (hit && hit.count >= count) return hit.out;
  let out: number[];
  if (c.version === 1) out = c.glyphs ? Array.from(c.glyphs).slice(0, count) : [];
  else {
    out = [];
    for (const r of c.rangeRecords ?? []) {
      if (--work.left < 0) throw new Error('coverage too large');
      const from = r.startCoverageIndex;
      const n = Math.min(r.end - r.start + 1, count - from);
      for (let k = 0; k < n; k++) out[from + k] = r.start + k;
      work.left -= Math.max(0, n);
    }
  }
  work.left -= out.length;
  if (work.left < 0) throw new Error('coverage too large');
  memo.set(c, { count, out });
  return out;
}
/**
 * 書体 font の、機能 features (liga・dlig など) の合字の表。合字の表 (LookupType 4) が無ければ null。書体と機能の組ごとに覚える。
 * 用字系・言語の別は見ない (どれかの用字系で有効な並びを候補にする。実際に 1 つの字形になるかは、呼ぶ側が書体の整形で確かめる)
 */
export function ligatureTable(font: LoadedFont, features: readonly string[]): LigatureTable | null {
  const key = features.join(',');
  let byKey = cache.get(font);
  if (!byKey) cache.set(font, (byKey = new Map()));
  let t = byKey.get(key);
  if (t === undefined) {
    try {
      // 整形の表の読みの予算の中で読む (fontSanity.ts。壊れた・細工した表の読みが、上限なしに大きくならないように)
      t = withLayoutBudget(font.fk, () => readLigatureTable(font, features));
    } catch {
      t = null;
    }
    byKey.set(key, t);
  }
  return t;
}

function readLigatureTable(font: LoadedFont, features: readonly string[]): LigatureTable | null {
  const fk = font.fk as unknown as { GSUB?: FkGsub; glyphForCodePoint(cp: number): { id: number }; hasGlyphForCodePoint(cp: number): boolean };
  const gsub = fk.GSUB;
  if (!gsub?.featureList || !gsub.lookupList) return null;
  const lookups = new Set<number>();
  for (const f of gsub.featureList) if (features.includes(f.tag)) for (const i of f.feature.lookupListIndexes) lookups.add(i);
  if (!lookups.size) return null;
  const byFirst = new Map<number, number[][]>();
  let maxLen = 0;
  // 広げる手間の上限: 字形の数の 64 倍 + 100 万 (正当な書体は、合字の副表の Coverage の合計が字形の数ほど)。超えたら、合字の表は無いものとする
  const work = { left: 64 * ((fk as { numGlyphs?: number }).numGlyphs ?? 0) + 1_000_000 };
  const memo = new Map<FkCoverage, { count: number; out: number[] }>();
  // Lookup は番号の順に当たる (OpenType の仕様の「Lookup List table」)
  for (const i of [...lookups].sort((a, b) => a - b)) {
    const lookup = gsub.lookupList.get(i);
    for (const st0 of lookup.subTables) {
      // LookupType 7 (Extension) は、中の表を見る
      const type = lookup.lookupType === 7 ? st0.lookupType : lookup.lookupType;
      const st = lookup.lookupType === 7 ? st0.extension : st0;
      if (type !== 4 || !st?.coverage || !st.ligatureSets) continue;
      const firsts = coverageGlyphs(st.coverage, st.ligatureSets.length, memo, work);
      for (let k = 0; k < st.ligatureSets.length; k++) {
        const first = firsts[k];
        if (first === undefined) continue;
        let list = byFirst.get(first);
        if (!list) byFirst.set(first, (list = []));
        for (const lig of st.ligatureSets.get(k)) {
          if (--work.left < 0) throw new Error('ligature table too large');
          list.push(Array.from(lig.components));
          maxLen = Math.max(maxLen, lig.compCount);
        }
      }
    }
  }
  if (!byFirst.size) return null;
  // 欧文の字の字形 (従来から合字の候補にしている字)
  const latin = new Set<number>();
  const add = (cp: number) => {
    if (fk.hasGlyphForCodePoint(cp)) latin.add(fk.glyphForCodePoint(cp).id);
  };
  for (let cp = 0x41; cp <= 0x5a; cp++) add(cp), add(cp + 0x20);
  for (let cp = 0xfb00; cp <= 0xfb04; cp++) add(cp);
  let extended = maxLen > 4;
  if (!extended) {
    outer: for (const [first, list] of byFirst) {
      if (!latin.has(first)) {
        extended = true;
        break;
      }
      for (const comps of list)
        if (comps.some((g) => !latin.has(g))) {
          extended = true;
          break outer;
        }
    }
  }
  return { byFirst, maxLen, extended };
}
