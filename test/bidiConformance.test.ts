/**
 * UAX #9 の公式の試験 (BidiCharacterTest.txt・BidiTest.txt。Unicode 18.0.0) を、resolveLevels・lineLevels・visualOrder に通す。
 *
 * 試験のデータは他の人の著作物なのでリポジトリには入れない。無ければ unicode.org から取得して .cache/unicode に置く (test/ucdTestData.ts)。
 * 取得できない環境では、公式の試験の代わりに、下の手書きの小さな並び (同じ書き方) だけを確かめる。
 *
 * 試験が見るのは、段落の深さ (P2・P3)、字ごとの深さ (X1〜I2 と、全体を 1 行としたときの L1)、左から右へ描く順 (L2)。
 * 段落の分け方 (P1)・結合する字の並べ替え (L3)・鏡像の字 (L4) は、試験の範囲の外 (どちらのファイルも先頭の説明にそう書いてある)。
 */
import { describe, expect, it } from 'vitest';
import { lineLevels, resolveLevels, visualOrder, type BidiClass } from '../src/bidi';
import { ucdTestData } from './ucdTestData';

/** X9 で取り除く字 (試験の深さは x、描く順には出てこない) */
const REMOVED = new Set<BidiClass>(['RLE', 'LRE', 'RLO', 'LRO', 'PDF', 'BN']);

/** 全体を 1 行として、段落の深さ・字ごとの深さ (取り除く字は x)・描く順 (取り除く字は出さない) を、試験の書き方の文字列にする */
function resolved(cps: number[], dir: 'ltr' | 'rtl' | 'auto', classes?: BidiClass[]): { level: number; levels: string; order: string } {
  const p = resolveLevels(cps, dir, classes);
  const lv = lineLevels(p, 0, cps.length);
  return {
    level: p.level,
    levels: Array.from(lv, (v, i) => (REMOVED.has(p.types[i]) ? 'x' : String(v))).join(' '),
    order: visualOrder(lv)
      .filter((i) => !REMOVED.has(p.types[i]))
      .join(' '),
  };
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/**
 * BidiCharacterTest.txt の書き方の行を確かめ、試した行の数と、合わなかった行 (期待と実際) を返す。
 * 行は「字の並び (16 進); 段落の向き (0: 左から右、1: 右から左、2: 最初の強い字から); 段落の深さ; 字ごとの深さ; 描く順」
 */
function runCharacterTest(data: string): { total: number; failed: string[] } {
  const failed: string[] = [];
  let total = 0;
  for (const line of data.split('\n')) {
    const body = line.split('#')[0].trim();
    if (!body) continue;
    const f = body.split(';');
    const dir = (['ltr', 'rtl', 'auto'] as const)[Number(f[1])];
    // 読めない行は、黙って飛ばさずに、合わなかった行に数える
    if (f.length !== 5 || !dir) {
      failed.push(`読めない行: ${body}`);
      continue;
    }
    total++;
    const r = resolved(
      words(f[0]).map((x) => parseInt(x, 16)),
      dir,
    );
    const want = `${Number(f[2])}; ${words(f[3]).join(' ')}; ${words(f[4]).join(' ')}`;
    const got = `${r.level}; ${r.levels}; ${r.order}`;
    if (got !== want) failed.push(`${body} → ${got}`);
  }
  return { total, failed };
}

/**
 * BidiTest.txt の書き方の行を確かめ、試した数 (行 × 段落の向き) と、合わなかったものを返す。
 * 「@Levels: 深さ」「@Reorder: 描く順」の行が、次の同じ種類の行までの期待。データの行は「Bidi_Class の並び; 段落の向きのビット (1: 最初の強い字から、2: 左から右、4: 右から左)」。
 * 字の性質だけの試験なので、Bidi_Class を resolveLevels の classes に渡す (字は括弧の対にならない U+0041 にする。この試験には括弧の対は無い)
 */
function runClassTest(data: string): { total: number; failed: string[] } {
  const failed: string[] = [];
  let total = 0;
  let levels = '';
  let order = '';
  for (const line of data.split('\n')) {
    const body = line.split('#')[0].trim();
    if (!body) continue;
    if (body.startsWith('@Levels:')) levels = words(body.slice(8)).join(' ');
    else if (body.startsWith('@Reorder:')) order = words(body.slice(9)).join(' ');
    if (body.startsWith('@')) continue; // ほかの @ の行は読み飛ばす決まり (ファイルの先頭の説明)
    const f = body.split(';');
    const bits = parseInt(f[1], 16);
    if (f.length !== 2 || !(bits >= 1 && bits <= 7)) {
      failed.push(`読めない行: ${body}`);
      continue;
    }
    const classes = words(f[0]) as BidiClass[];
    const cps = classes.map(() => 0x41);
    for (const [bit, dir] of [
      [1, 'auto'],
      [2, 'ltr'],
      [4, 'rtl'],
    ] as const) {
      if (!(bits & bit)) continue;
      total++;
      const r = resolved(cps, dir, classes);
      if (r.levels !== levels || r.order !== order) failed.push(`${body} (${dir}) → ${r.levels}; ${r.order} (期待 ${levels}; ${order})`);
    }
  }
  return { total, failed };
}

/**
 * 手書きの並び (BidiCharacterTest.txt の書き方)。期待は UAX #9 の規則から決めた:
 *  - 左から右の段落の中のヘブライ文字は深さ 1 で、逆順に描く (I1・L2)
 *  - 右から左の段落の中の数字は深さ 2 (W・I2)、行末の空白は段落の深さ (L1)
 *  - RLE〜PDF は取り除く字 (X9)。中の L は深さ 2 (X2・I2)
 *  - RLI〜PDI の中は深さ 1、RLI・PDI は外の深さ (X5a・X6a)
 *  - 右から左の段落の括弧の対は、中の字と前の文脈が L なら L (N0)
 *  - 最初の強い字が AL なら段落は右から左 (P2・P3)。その後の欧文の数字は AN の扱い (W2) で深さ 2
 */
const HAND_CHARACTER = [
  '0061 0062 0020 05D0 05D1 05D2 0020 0063; 0; 0; 0 0 0 1 1 1 0 0; 0 1 2 5 4 3 6 7',
  '05D0 05D1 0020 0031 0032 0020; 1; 1; 1 1 1 2 2 1; 5 3 4 2 1 0',
  '0061 202B 0062 202C 0063; 0; 0; 0 x 2 x 0; 0 2 4',
  '0061 2067 05D0 0062 2069 0063; 0; 0; 0 0 1 2 0 0; 0 1 3 2 4 5',
  '05D0 0020 0061 0028 0062 0029 0020 05D1; 1; 1; 1 1 2 2 2 2 1 1; 7 6 2 3 4 5 1 0',
  '0627 0020 0031 0032; 2; 1; 1 1 2 2; 2 3 1 0',
];

/** 手書きの並び (BidiTest.txt の書き方) */
const HAND_CLASS = ['@Levels: 0 1 1 0', '@Reorder: 0 2 1 3', 'L R R L; 3', 'L R AL L; 3', '@Levels: x 2 x', '@Reorder: 1', 'RLE L PDF; 3', '@Levels: 1 1 2', '@Reorder: 2 1 0', 'R WS EN; 5', '@Levels: 0 0', '@Reorder: 0 1', 'L B; 3', 'ON B; 3'];

describe('UAX #9 の公式の試験 (BidiCharacterTest.txt・BidiTest.txt)', () => {
  it('BidiCharacterTest.txt の行 (取得できなければ手書きの並び) が、規則どおりの段落の深さ・字の深さ・描く順になる', async () => {
    const data = await ucdTestData('BidiCharacterTest.txt');
    const { total, failed } = runCharacterTest(data ?? HAND_CHARACTER.join('\n'));
    // Unicode 18.0.0 のファイルは 91707 行。取得したものが途中で切れていないことも兼ねて、数の下限を見る
    expect(total).toBeGreaterThan(data ? 91000 : HAND_CHARACTER.length - 1);
    expect(failed).toEqual([]);
  });

  it('BidiTest.txt の行 (取得できなければ手書きの並び) が、規則どおりの字の深さ・描く順になる', async () => {
    const data = await ucdTestData('BidiTest.txt');
    const { total, failed } = runClassTest(data ?? HAND_CLASS.join('\n'));
    // Unicode 18.0.0 のファイルは、行 × 段落の向きで 770241 件
    expect(total).toBeGreaterThan(data ? 770000 : 10);
    expect(failed).toEqual([]);
  });

  it('手書きの並びは、公式の試験が取得できるときにも通る (取得できない環境で代わりに使うものが正しいこと)', () => {
    const c = runCharacterTest(HAND_CHARACTER.join('\n'));
    expect(c).toEqual({ total: HAND_CHARACTER.length, failed: [] });
    const k = runClassTest(HAND_CLASS.join('\n'));
    expect(k).toEqual({ total: 12, failed: [] });
  });

  it('合わない行・読めない行は、黙って飛ばさずに数える (試験の読み方の確かめ)', () => {
    // 期待の深さをわざと違えた行と、欄の足りない行
    const c = runCharacterTest('0061 05D0; 0; 0; 0 0; 0 1\n0061 05D0; 0; 0');
    expect(c.total).toBe(1);
    expect(c.failed).toHaveLength(2);
    const k = runClassTest('@Levels: 0 0\n@Reorder: 0 1\nL R; 2\nL R');
    expect(k.total).toBe(1);
    expect(k.failed).toHaveLength(2);
  });
});
