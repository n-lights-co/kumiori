/**
 * 行グリッド (アンテナハウスの axf:baseline-grid / -ah-baseline-grid) の中の行の積み方:
 * 行グリッドの中では半行間を空けず、字の仮想ボディ (em の箱) を前の行の em の箱の下端に続けて、基線を次の格子に載せる。
 *  - 小さい字の行 (行の高さは同じ) の後ろの行は、次の格子に載る (前の行の下の半行間で 1 つ先へ送らない)
 *  - 字の大きい見出しの行は、em の箱が入る格子まで送り、その次の本文の行は次の格子に載る
 *  - 行の中に大きい字があれば、その字の em の箱の分だけ送る
 * 見本の PDF (公開の XSL-FO の見本の行グリッドの例と、CSS の本の章の見出し) の基線の位置との比較による。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { doc, makeEngine } from './helpers';
import type { GlyphArea, LBlock, LBlockLevel } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

/** 行ごとの、最初の字の基線の位置と字 */
function baselines(children: LBlockLevel[]): Array<{ text: string; y: number }> {
  const t = E.engine.layout(doc(children));
  const out: Array<{ text: string; y: number }> = [];
  const visit = (n: unknown, oy: number, line: { text: string; y: number } | undefined) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((c) => visit(c, oy, line));
    const a = n as { type?: string; y?: number; padding?: { top?: number }; border?: { top?: { width?: number } } } & Partial<Omit<GlyphArea, 'type' | 'y'>>;
    // 子の位置は、箱の内容の上端から (padding と罫線の分を足す)
    const y = oy + (a.y ?? 0) + (a.type === 'block' ? (a.padding?.top ?? 0) + (a.border?.top?.width ?? 0) : 0);
    let cur = line;
    if (a.type === 'line') {
      cur = { text: '', y: NaN };
      out.push(cur);
    }
    if (a.type === 'glyph' && cur) {
      if (Number.isNaN(cur.y)) cur.y = y + (a.baselineY ?? 0);
      cur.text += a.text ?? '';
    }
    for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') visit(v, y, cur);
  };
  visit(t.sheets[0], 0, undefined);
  return out.filter((l) => l.text);
}
const steps = (ls: Array<{ y: number }>, pitch: number) => ls.slice(1).map((l, i) => (l.y - ls[i].y) / pitch);
const grid = (over: Partial<LBlock>, children: LBlock['children']): LBlock => ({ type: 'block', baselineGrid: 'new', fontSize: 10, lineHeightPt: 14, ...over, children }) as LBlock;

describe('行グリッドの中の行の積み方 (em の箱を続けて、次の格子に載せる)', () => {
  it('同じ大きさの字の行は、格子 1 つずつ (変わらない)', () => {
    const ls = baselines([grid({}, ['いろは\nにほへ\nとちり'])]);
    expect(ls.map((l) => l.text)).toEqual(['いろは', 'にほへ', 'とちり']);
    for (const s of steps(ls, 14)) expect(s).toBeCloseTo(1, 3);
  });

  it('見出しの中の小さい字のブロック (章の番号) の次の行 (題) は、次の格子に載る', () => {
    // 章の見出し: 16pt・行の高さ 17.7pt の行グリッド。中の最初のブロックは 8pt (行の高さは同じ 17.7pt)
    const ls = baselines([
      grid({ fontSize: 16, lineHeightPt: 17.7 }, [{ type: 'block', fontSize: 8, lineHeightPt: 17.7, children: ['第四章'] } as LBlock, '段落設定']),
      { type: 'block', fontSize: 10, lineHeightPt: 14, children: ['本文'] } as LBlock,
    ]);
    expect(ls.map((l) => l.text)).toEqual(['第四章', '段落設定', '本文']);
    // 8pt の行の下の半行間 (4.85pt) を数えると、題が格子 2 つ先 (35.4pt) へ送られてしまう
    expect(ls[1].y - ls[0].y).toBeCloseTo(17.7, 3);
  });

  it('字の大きい見出しの行は、em の箱が入る格子まで送り、次の本文の行は次の格子に載る', () => {
    // 10pt・14pt の行グリッドの中の、25pt (line-height 2 = 50pt) の見出し
    const ls = baselines([
      grid({}, [
        { type: 'block', children: ['本文一\n本文二'] } as LBlock,
        { type: 'block', fontSize: 25, lineHeight: 2, children: ['見出し'] } as LBlock,
        { type: 'block', children: ['本文三\n本文四'] } as LBlock,
      ]),
    ]);
    expect(ls.map((l) => l.text)).toEqual(['本文一', '本文二', '見出し', '本文三', '本文四']);
    const s = steps(ls, 14);
    // 見出し: 25pt の em の箱の上 (22pt ほど) が前の行の下に入るのは格子 2 つ先。行の高さ 50pt (格子 4 つ分) は空けない
    expect(s[0]).toBeCloseTo(1, 3);
    expect(s[1]).toBeCloseTo(2, 3);
    // 見出しの次の本文は、すぐ次の格子
    expect(s[2]).toBeCloseTo(1, 3);
    expect(s[3]).toBeCloseTo(1, 3);
  });

  it('行の中の大きい字: 14pt の字は格子 1 つ、25pt の字は格子 2 つ送り、その次の行は格子 1 つ', () => {
    const ls = baselines([
      grid({}, [
        'いろは\n',
        'にほ',
        { type: 'inline', fontSize: 14, children: ['大'] },
        'へと\n',
        'ちり',
        { type: 'inline', fontSize: 25, children: ['特大'] },
        'ぬる\n',
        'をわか',
      ] as LBlock['children']),
    ]);
    expect(ls.map((l) => l.text)).toEqual(['いろは', 'にほ大へと', 'ちり特大ぬる', 'をわか']);
    const s = steps(ls, 14);
    expect(s[0]).toBeCloseTo(1, 3);
    expect(s[1]).toBeCloseTo(2, 3);
    expect(s[2]).toBeCloseTo(1, 3);
  });

  it('罫線・余白のある箱をはさむ行は、いままでどおり箱の中の行の上端から格子を探す', () => {
    const ls = baselines([{ type: 'block', baselineGrid: 'new', lineHeight: 1.5, children: [{ type: 'block', children: ['a'] }, { type: 'block', padding: { top: 6 }, children: ['b'] }, { type: 'block', children: ['c'] }] } as never]);
    const s = steps(ls, 15);
    expect(s[0]).toBeCloseTo(2, 3);
    expect(s[1]).toBeCloseTo(1, 3);
  });
});

describe('行グリッドを作った箱の終わり (最後の行の後ろに半行間を空けない)', () => {
  /** 最初のページの、流れの直下の箱の位置と高さ */
  const boxes = (children: LBlockLevel[]) => {
    const t = E.engine.layout(doc(children));
    const out: Array<{ y: number; h: number }> = [];
    const visit = (n: unknown, depth: number) => {
      if (!n || typeof n !== 'object' || out.length) return;
      if (Array.isArray(n)) return n.forEach((c) => visit(c, depth));
      const a = n as { type?: string; children?: Array<{ type?: string; y: number; height: number }> };
      if (a.children && a.children.length >= 2 && a.children.every((c) => c.type === 'block')) {
        for (const c of a.children) out.push({ y: c.y, h: c.height });
        return;
      }
      for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') visit(v, depth + 1);
    };
    visit(t.sheets[0], 0);
    return out;
  };
  const after = { type: 'block', fontSize: 10, lineHeightPt: 14, children: ['本文'] } as LBlock;

  it('1 行の見出し (12pt・行の高さ 18pt): 箱の高さは字の em の箱 (12pt)。次の箱は、その下端から始まる', () => {
    const b = boxes([grid({ fontSize: 12, lineHeightPt: 18 }, ['見出し']), after]);
    expect(b[0].h).toBeCloseTo(12, 3);
    expect(b[1].y - b[0].y).toBeCloseTo(12, 3);
  });

  it('2 行の見出し: 1 行目の基線から格子 1 つで 2 行目。箱の高さは 行の高さ + em の箱 (18 + 12pt)', () => {
    const b = boxes([grid({ fontSize: 12, lineHeightPt: 18 }, ['見出しの一\n見出しの二']), after]);
    expect(b[0].h).toBeCloseTo(30, 3);
  });

  it('下の padding のある見出し: padding は em の箱の下端から', () => {
    const b = boxes([grid({ fontSize: 12, lineHeightPt: 18, padding: { top: 0, right: 0, bottom: 3, left: 0 } } as never, ['見出し']), after]);
    expect(b[0].h).toBeCloseTo(15, 3);
  });

  it('行グリッドの無い箱は変わらない (行の高さ 18pt)', () => {
    const b = boxes([{ type: 'block', fontSize: 12, lineHeightPt: 18, children: ['見出し'] } as LBlock, after]);
    expect(b[0].h).toBeCloseTo(18, 3);
  });
});
