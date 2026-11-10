/**
 * UAX #29 の公式の試験 (GraphemeBreakTest.txt。Unicode 18.0.0) を、graphemeClusters に通す。
 *
 * 試験のデータは他の人の著作物なのでリポジトリには入れない。.cache/unicode に無ければ unicode.org から取得して置く
 * (KUMIORI_UCD_DIR で場所を上書きできる)。取得できない環境では、公式の試験の代わりに、下の手書きの小さな並びだけを確かめる
 * (test/lineBreakConformance.test.ts と同じやり方)。
 */
import { describe, expect, it } from 'vitest';
import { clusterUnits, graphemeClusters, mayCluster } from '../src/grapheme';
import { ucdTestData } from './ucdTestData';

/** 試験のデータ。取得できなければ undefined */
const graphemeBreakTestData = () => ucdTestData('auxiliary/GraphemeBreakTest.txt');

/** 試験の 1 行 (÷ 0061 × 0308 ÷ 0062 ÷ # 注記) を、文字列と、期待するクラスタの並びに */
function parseLine(line: string): { text: string; clusters: string[] } | undefined {
  const body = line.split('#')[0].trim();
  if (!body) return undefined;
  const clusters: string[] = [];
  let brk = true;
  for (const t of body.split(/\s+/)) {
    if (t === '÷') brk = true;
    else if (t === '×') brk = false;
    else {
      const ch = String.fromCodePoint(parseInt(t, 16));
      if (brk) clusters.push(ch);
      else clusters[clusters.length - 1] += ch;
    }
  }
  return { text: clusters.join(''), clusters };
}

/** 手書きの並び (公式の試験の書き方)。GB3・GB6〜GB8・GB9・GB9a・GB9b・GB9c・GB11・GB12/13 */
const HAND_WRITTEN = [
  '÷ 000D × 000A ÷ 0061 ÷',
  '÷ 0061 ÷ 000A ÷ 0308 ÷',
  '÷ 0065 × 0301 ÷ 0062 ÷',
  '÷ 304B × 3099 ÷ 304D ÷',
  '÷ 1100 × 1161 × 11A8 ÷ 1100 ÷',
  '÷ AC00 × 11A8 ÷ AC01 ÷',
  '÷ 0E01 × 0E34 ÷ 0E01 × 0E33 ÷',
  '÷ 0600 × 0031 ÷ 0032 ÷',
  '÷ 0915 × 094D × 0937 × 093F ÷ 0915 ÷',
  '÷ 0915 × 094D × 200D × 0937 ÷',
  '÷ 0061 × 094D ÷ 0062 ÷',
  '÷ 1F468 × 200D × 1F469 × 200D × 1F467 ÷ 1F468 ÷',
  '÷ 1F44D × 1F3FD ÷ 1F44D ÷',
  '÷ 0061 × 200D ÷ 1F467 ÷',
  '÷ 1F1EF × 1F1F5 ÷ 1F1FA × 1F1F8 ÷ 1F1EF ÷',
  '÷ 0031 × FE0F × 20E3 ÷ 0032 ÷',
  '÷ 1F3F4 × E0067 × E0062 × E0065 × E006E × E0067 × E007F ÷',
  '÷ 845B × E0100 ÷ 3042 ÷',
];

describe('UAX #29 の書記素クラスタ (GraphemeBreakTest.txt)', () => {
  it('公式の試験の行 (取得できなければ手書きの並び) が、規則どおりのクラスタになる', async () => {
    const data = await graphemeBreakTestData();
    const lines = [...(data ? data.split('\n') : []), ...HAND_WRITTEN];
    const failed: string[] = [];
    let total = 0;
    for (const line of lines) {
      const t = parseLine(line);
      if (!t) continue;
      total++;
      if (JSON.stringify(graphemeClusters(t.text)) !== JSON.stringify(t.clusters)) failed.push(line.split('#')[0].trim());
    }
    expect(total).toBeGreaterThan(data ? 700 : HAND_WRITTEN.length - 1);
    expect(failed).toEqual([]);
  });

  it('実行環境の Intl.Segmenter と、よく使う並びで同じ結果になる (照合だけ。組版には使わない)', () => {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    for (const s of ['éä́', 'がき゚', '👨‍👩‍👧👍🏽🇯🇵🇺🇸1️⃣', 'กิ่ง한각', '葛\u{E0100}城', 'abc あいう 漢字'])
      expect(graphemeClusters(s)).toEqual([...seg.segment(s)].map((x) => x.segment));
  });

  it('2 字以上のクラスタを含みうるかの見分け: 含まない文字列は false、含む文字列は true', () => {
    for (const s of ['', 'Hello, world!', 'あいう漢字。「」', 'café ©®', '한국어', '𠮷野家 😀', '\r\n\t­​']) expect(mayCluster(s)).toBe(false);
    for (const s of ['é', 'が', '👍🏽', '👨‍👩‍👧', '🇯🇵', '1️⃣', '葛\u{E0100}', '가', 'กิ', '؀', '🏴\u{E0067}']) expect(mayCluster(s)).toBe(true);
    // 見分けが false の文字列は、クラスタに分けても 1 字ずつ (公式の試験にある字の組でも)
    for (const s of ['Hello', 'あい', '한국', '𠮷😀']) expect(graphemeClusters(s)).toEqual([...s]);
  });

  it('組版の字の単位: CR LF はまとめず、空白を基底の字にせず、前の段階の単位はそのまま。まとめるものが無ければ null', () => {
    expect(clusterUnits('あいう abc')).toBeNull();
    expect(clusterUnits('\r\n')).toBeNull();
    expect(clusterUnits('éが')).toEqual(['é', 'が']);
    // 空白の後ろの結合文字は、空白にまとめない (UAX #14 LB9・LB10)。続く結合文字は、最初の結合文字にまとめる
    expect(clusterUnits(' ́')).toBeNull();
    expect(clusterUnits('a ́̂b́')).toEqual(['a', ' ', '́̂', 'b́']);
    expect(clusterUnits('　゙が')).toBeNull();
    // 合字 (前の段階でまとめた単位) の後ろの結合文字は、合字にまとめない
    expect(clusterUnits(['ffi', '́', 'e', '́'])).toEqual(['ffi', '́', 'é']);
    expect(clusterUnits(['👨', '‍', '👩', '🇯', '🇵', '🇺', '🇸'])).toEqual(['👨‍👩', '🇯🇵', '🇺🇸']);
  });
});
