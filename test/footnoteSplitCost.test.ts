/**
 * 脚注を行の単位で分ける手間 (footnotes.ts の splitEntry)。分けるたびの手間は、前に置く分 (head) に比例し、残りの行の数には比例しない。
 * 1 ページに 1 行ずつしか置けない長い脚注を続くページへ分け続けても、全体の手間は行の数に比例する
 */
import { describe, expect, it } from 'vitest';
import { splitEntry, footUnits, type FootEntry } from '../src/footnotes';
import { newNode, type LNode } from '../src/lnode';
import { expectGrowth } from './timing';

/** 行 n 本 (高さ 12) の段落を、blocks 個の段落に分けて入れた脚注 */
function note(n: number, blocks = 1): FootEntry {
  const root = newNode('block', 'horizontal-tb', { isize: 100, bsize: 0 });
  const per = Math.ceil(n / blocks);
  let y = 0;
  for (let p = 0; p < blocks; p++) {
    const blk = newNode('block', 'horizontal-tb', { isize: 100, b: y, bsize: 0 });
    for (let k = 0; k < per && p * per + k < n; k++) blk.children.push(newNode('line', 'horizontal-tb', { isize: 100, b: k * 12, bsize: 12 }));
    blk.bsize = blk.children.length * 12;
    root.children.push(blk);
    y += blk.bsize;
  }
  root.bsize = y;
  return { node: root, height: y };
}

/** 1 行ずつ分け切る。分けた回数と、置いた行の数 */
function splitAll(e: FootEntry): { splits: number; lines: number } {
  let splits = 0;
  let lines = 0;
  const count = (n: LNode): number => (n.kind === 'line' ? 1 : n.children.reduce((a, c) => a + count(c), 0));
  for (;;) {
    const sp = splitEntry(e, 12);
    if (!sp) break;
    splits++;
    lines += count(sp.head.node);
    e = sp.rest;
  }
  return { splits, lines: lines + count(e.node) };
}

describe('脚注を分ける手間', () => {
  it('1 行ずつ分け切ると、行の数を 4 倍にしても、手間はほぼ 4 倍 (行の数の 2 乗にならない)', async () => {
    const n = 10000;
    expect(splitAll(note(n))).toEqual({ splits: n - 1, lines: n });
    expect(splitAll(note(n, 7))).toEqual({ splits: n - 1, lines: n });
    // 線形なら比は 4、2 乗なら 16。前は 2 倍の行で比べ、壁の時計の値を 1 度ずつ測ったので、負荷のある機械で 2 度に 1 度ほど落ちた。
    // いまは 4 倍の行で、CPU の時間を交互に測って一番短い値どうしを比べる (test/timing.ts)
    await expectGrowth(8, (m) => splitAll(note(m)), n, { label: '1 段落の脚注' });
    await expectGrowth(8, (m) => splitAll(note(m, 7)), n, { label: '7 段落の脚注' });
  }, 120_000);

  it('1 行ずつ分け切るとき、子の並びを読む回数は行の数に比例する (機械の負荷に揺れない数え方)', () => {
    /** 段落の子の並びを、要素を読むたびに数える並びに置き換えて、分け切る */
    const reads = (n: number, blocks: number): number => {
      const e = note(n, blocks);
      let r = 0;
      for (const blk of e.node.children) {
        blk.children = new Proxy(blk.children, {
          get(t, p, recv) {
            if (typeof p === 'string' && /^\d+$/.test(p)) r++;
            return Reflect.get(t, p, recv);
          },
        });
      }
      expect(splitAll(e)).toEqual({ splits: n - 1, lines: n });
      return r;
    };
    for (const blocks of [1, 5]) {
      const r1 = reads(2000, blocks);
      const r2 = reads(4000, blocks);
      // 行 1 本あたり、決まった回数まで。数えるのは、元の段落の子の並び (Proxy) を読む回数だけなので、これは直した形 (残りを写さずに、
      // 元の並び・始まりの位置・差し引く量で持つ形) が崩れないかの守り。直す前の形は、分けるたびに残りを新しい並びに写して、
      // その写しを読む (Proxy を通らない) ので、この数には出ず、直す前でも通る。前の形の 2 乗の手間は、上の時間の伸び方のテストが捕まえる
      expect(r1, `${blocks} 段落`).toBeLessThan(20 * 2000);
      expect(r2 / r1, `${blocks} 段落`).toBeLessThan(2.2);
    }
  });

  it('20 万行の脚注も、例外を出さずに分ける (子の数が多くても、関数に配列を広げて渡さない)', () => {
    const e = note(200_000);
    const sp = splitEntry(e, 30);
    expect(sp).not.toBe(null);
    expect(sp!.head.height).toBe(24);
    expect(sp!.rest.height).toBe((200_000 - 2) * 12);
    // 残りは、分けた段落の残り 1 つ (その中に行が 20 万 - 2 本。先頭の行の位置は 0)
    expect(sp!.rest.node.children).toHaveLength(1);
    expect(sp!.rest.node.children[0].b).toBe(0);
    expect(sp!.rest.node.children[0].children).toHaveLength(200_000 - 2);
    expect(sp!.rest.node.children[0].children[0].b).toBe(0);
    expect(footUnits(sp!.rest)).toBe(200_000 - 2);
  });

  it('分けた残りを、そのまま続けて分けても、箱にしてから分けても、同じに分ける', () => {
    const a = splitEntry(note(50, 3), 100)!;
    const viaView = splitEntry(a.rest, 100)!;
    const asNode = splitEntry({ node: structuredClone(a.rest.node), height: a.rest.height, cont: true }, 100)!;
    expect(viaView.head.node).toEqual(asNode.head.node);
    expect(viaView.rest.node).toEqual(asNode.rest.node);
    expect(viaView.rest.height).toBe(asNode.rest.height);
  });
});
