/**
 * UAX #14 の公式の試験 (LineBreakTest.txt。Unicode 18.0.0) を、調整なしの lineBreakActions に通す。
 *
 * 試験のデータは他の人の著作物なのでリポジトリには入れない。.cache/unicode に無ければ unicode.org から取得して置く
 * (test/ucdTestData.ts。KUMIORI_UCD_DIR で場所を上書きできる)。取得できない環境では、公式の試験の代わりに、下の手書きの小さな並びだけを確かめる。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lineBreakActions } from '../src/lineBreak';
import { UCD_VERSION, ucdTestData } from './ucdTestData';

/** 試験の 1 行 (× 0061 ÷ 0020 ÷ # 注記) を、字の並びと、字の間ごとの期待 (true = 改行してよい) に */
function parseLine(line: string): { cps: number[]; brk: boolean[] } | undefined {
  const body = line.split('#')[0].trim();
  if (!body) return undefined;
  const toks = body.split(/\s+/);
  const cps: number[] = [];
  const brk: boolean[] = [];
  for (const t of toks) {
    if (t === '×' || t === '÷') brk.push(t === '÷');
    else cps.push(parseInt(t, 16));
  }
  return { cps, brk };
}

/** 字の間ごとに、期待と合わない位置の数 (先頭と末尾は見ない) */
function mismatches(cps: number[], brk: boolean[]): number {
  const act = lineBreakActions(cps);
  let bad = 0;
  for (let i = 1; i < cps.length; i++) if ((act[i] !== '×') !== brk[i]) bad++;
  return bad;
}

/** 手書きの並び (公式の試験の書き方)。LB12a は Unicode 18 で [^SP HY HH] × GL (BA の後ろの GL の前は改行しない) */
const HAND_WRITTEN = [
  '× 0061 × 2013 × 00A0 × 0062 ÷',
  '× 0061 × 002D ÷ 00A0 × 0062 ÷',
  '× 0061 × 2010 ÷ 00A0 × 0062 ÷',
  '× 0061 × 0020 ÷ 00A0 × 0062 ÷',
  '× 0061 × 0020 ÷ 0062 ÷',
  '× 0061 × 0308 × 0020 ÷ 0062 ÷',
  '× 3042 ÷ 3044 × 3001 ÷ 3046 ÷',
];

describe('UAX #14 の公式の試験 (LineBreakTest.txt)', () => {
  it('公式の試験の行 (取得できなければ手書きの並び) が、規則どおりの改行の機会になる', async () => {
    const data = await ucdTestData('auxiliary/LineBreakTest.txt');
    const lines = (data ?? HAND_WRITTEN.join('\n')).split('\n');
    const failed: string[] = [];
    let total = 0;
    for (const line of lines) {
      const t = parseLine(line);
      if (!t) continue;
      total++;
      if (mismatches(t.cps, t.brk) > 0) failed.push(line.split('#')[0].trim());
    }
    expect(total).toBeGreaterThan(data ? 19000 : HAND_WRITTEN.length - 1);
    expect(failed).toEqual([]);
  });

  it('試験のデータの版は、字の性質の表 (src/unicodeData.ts) を作った UCD の版と同じ', () => {
    // 版が違うと、試験の期待と表の字の性質が食い違う (新しい字・性質の変わった字)。表を作り直したら UCD_VERSION も合わせる
    const head = fs.readFileSync(path.resolve(__dirname, '../src/unicodeData.ts'), 'utf8').slice(0, 400);
    expect(head).toContain(`(UCD ${UCD_VERSION})`);
    expect(head).toContain(`https://www.unicode.org/Public/${UCD_VERSION}/ucd/`);
  });
});
