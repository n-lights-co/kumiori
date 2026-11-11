import { beforeAll, describe, expect, it } from 'vitest';
import { FAMILY, doc, lines, makeEngine, master, mathFontBuffer, pt, walk } from './helpers';
import { AssetStore } from '../src/assets';
import { LayoutEngine } from '../src/layoutEngine';
import { ligatureUnits } from '../src/inlineLayout';
import { isLineEndProhibited, isLineHeadProhibited } from '../src/jis';
import { lineBreakActions } from '../src/lineBreak';
import type { Area, BlockArea, GlyphArea, ImageArea, LineArea } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const kids = (t: ReturnType<typeof E.engine.layout>, sheet = 0) => t.sheets[sheet].page.regionBody.children as BlockArea[];

describe('measurer', () => {
  it('縦中横: 2 桁は 1em に収まり、4 桁は横倒しへ退避する', () => {
    const st = { fontFamily: 'Noto Serif JP', fontSize: 10 };
    const two = E.measurer.tateChuYoko('12', st);
    expect(two.fits).toBe(true);
    expect(two.naturalWidth * two.scale).toBeLessThanOrEqual(10 + 1e-6);
    expect(E.measurer.tateChuYoko('2026', st).fits).toBe(false);
  });
  it('縦書き: 書体の縦書き用の字形 (OpenType の vert) があれば、その字形で正立にする', () => {
    const st = { fontFamily: 'Noto Serif JP', fontSize: 10 };
    const v = (c: string) => E.measurer.glyph(c, st, 'vertical-rl').vertical!;
    // 長音記号・括弧 (UAX #50 の Tr) は vert の字形で正立。漢字は字形を替えない。欧字は横倒し
    expect(v('ー')).toMatchObject({ mode: 'upright', features: ['vert'] });
    expect(v('「')).toMatchObject({ mode: 'upright', features: ['vert'] });
    expect(v('漢').features).toBeUndefined();
    expect(v('A').mode).toBe('rotate');
  });
});

describe('禁則', () => {
  it('両端揃えで、欧文のハイフンの後ろ (border-* の - と * の間) は広げない (CSS Text 3 §7.1)', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 120, textAlign: 'justify', children: ['ab cd-* ef gh ij kl mn op qr st uv wx yz ab cd ef gh ij kl'] } as never]));
    const gs: GlyphArea[] = [];
    walk(t.sheets[0].page.regionBody, (a) => a.type === 'glyph' && gs.push(a as GlyphArea));
    const k = gs.findIndex((g, i) => g.text === '-' && gs[i + 1]?.text === '*');
    expect(k).toBeGreaterThanOrEqual(0);
    expect(gs[k + 1].x - (gs[k].x + gs[k].width)).toBeCloseTo(0, 3);
  });

  it('組版結果: 通常の和文で行頭に閉じ括弧・句読点が来ない / 行末に開き括弧が来ない', () => {
    const text = 'これは禁則処理の確認用の文章です。「括弧」や、読点。小さなっゃゅも含みます。'.repeat(6);
    for (const w of [90, 101, 113, 127]) {
      const t = E.engine.layout(doc([{ type: 'block', width: w, textAlign: 'justify', children: [text] } as never]));
      const ls: GlyphArea[][] = [];
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type === 'line') {
          const g: GlyphArea[] = [];
          walk(a, (x) => x.type === 'glyph' && g.push(x));
          ls.push(g);
        }
      });
      ls.forEach((g, i) => {
        if (i > 0) expect(isLineHeadProhibited(g[0].text), `行頭 w=${w} line${i}`).toBe(false);
        if (i < ls.length - 1) expect(isLineEndProhibited(g[g.length - 1].text)).toBe(false);
      });
    }
  });

  it('ぶら下げ: 行末の句点は版面幅を超えて置かれる', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 50, children: ['あいうえお。かきくけこ'] } as never]));
    const b = kids(t)[0];
    const first = b.children[0] as LineArea;
    const gl: GlyphArea[] = [];
    walk(first, (x) => x.type === 'glyph' && gl.push(x));
    const hang = gl.find((g) => g.text === '。')!;
    expect(hang).toBeTruthy();
  });
});

describe('行末の句読点', () => {
  const firstLine = (t: ReturnType<typeof E.engine.layout>) => {
    const gl: GlyphArea[] = [];
    walk(kids(t)[0].children[0] as LineArea, (x) => x.type === 'glyph' && gl.push(x));
    return gl;
  };
  it('ぶら下げた句点は、揃えない行では最後の字のすぐ後ろに置く (版面端まで離さない)', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 55, textAlign: 'start', children: ['あいうえお。かき'] } as never]));
    const gl = firstLine(t);
    const last = gl.find((g) => g.text === 'お')!;
    const hang = gl.find((g) => g.text === '。')!;
    expect(hang.x).toBeCloseTo(last.x + last.width, 3);
  });
  it('追込み (JLREQ §3.8.2): 追い出す前に、行末の読点の後ろのアキを詰めて行に収める', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 55, textAlign: 'start', hangingPunctuation: false, children: ['あいうえお、かき'] } as never]));
    const gl = firstLine(t);
    const comma = gl.find((g) => g.text === '、')!;
    expect(comma).toBeTruthy();
    expect(comma.x + 5).toBeLessThanOrEqual(55 + 1e-6);
  });
  it('追込み: 行中の読点の後ろの二分アキも詰めてよい (§3.8.3)', () => {
    // あ、うえお。 = 60pt。行中の「、」の後ろ 5pt と行末の「。」の後ろ 5pt を詰めて 50pt
    const t = E.engine.layout(doc([{ type: 'block', width: 53, textAlign: 'start', hangingPunctuation: false, children: ['あ、うえお。かき'] } as never]));
    expect(firstLine(t).map((g) => g.text).join('')).toBe('あ、うえお。');
  });
  it('追込み: 行中の句点の後ろのアキは詰めないので、収まらなければ追い出す (§3.8.3)', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 53, textAlign: 'start', hangingPunctuation: false, children: ['あ。うえお、かき'] } as never]));
    expect(firstLine(t).map((g) => g.text).join('')).toBe('あ。うえ');
  });
  it('追込み: 中点類の前後の四分アキを詰めたら、字面を詰めた幅の中央に置く (前へ詰めた量の半分寄せる)', () => {
    // あいう・えお = 60pt を 58pt に: 「・」の前後のアキを 1pt ずつ詰め、字面を 1pt 前へ寄せる
    const t = E.engine.layout(doc([{ type: 'block', width: 58, textAlign: 'start', hangingPunctuation: false, children: ['あいう・えおかき'] } as never]));
    const gl = firstLine(t);
    expect(gl.map((g) => g.text).join('')).toBe('あいう・えお');
    expect(gl.find((g) => g.text === 'え')!.x).toBeCloseTo(38, 3);
    expect(gl.find((g) => g.text === '・')!.x).toBeCloseTo(29, 3);
  });
  it('追込み: 行末の約物の後ろのアキを、行中の読点のアキより先に詰める (§3.8.3 の順)', () => {
    // あ、うえお、 = 60pt を 57pt に: 行末の「、」の後ろだけを 3pt 詰める
    const t = E.engine.layout(doc([{ type: 'block', width: 57, textAlign: 'start', hangingPunctuation: false, children: ['あ、うえお、かき'] } as never]));
    const gl = firstLine(t);
    expect(gl.map((g) => g.text).join('')).toBe('あ、うえお、');
    expect(gl.find((g) => g.text === 'う')!.x).toBeCloseTo(20, 3);
  });
});

describe('空ける処理の順と限界 (JLREQ §3.8.4)', () => {
  /** 1 行目の字の x */
  const firstXs = (width: number, text: string) => {
    const t = E.engine.layout(doc([{ type: 'block', width, textAlign: 'justify', children: [text] } as never]));
    const gl: GlyphArea[] = [];
    walk(kids(t)[0].children[0] as LineArea, (x) => x.type === 'glyph' && gl.push(x));
    return gl.map((g) => [g.text, g.x] as const);
  };
  it('和字を含む行は、欧文間隔を先に (二分アキまで) 空け、和字の字間は後から空ける', () => {
    // 「あい えおかきくけこ」を、1 行目が「あい えお」で折れる幅に。余りは小さいので、語間だけで吸収する
    const nat = firstXs(1000, 'あい えお');
    const w = nat[nat.length - 1][1] + 10 + 2; // 2pt 余る
    const xs = firstXs(w, 'あい えおかきくけこ');
    const at = (ch: string) => xs.find(([t]) => t === ch)![1];
    expect(xs.map(([t]) => t).join('')).toBe('あい えお');
    // 「あ」「い」の間は空けない。語間の後ろの「え」が 2pt 右へ
    expect(at('い') - at('あ')).toBeCloseTo(10, 3);
    expect(at('え') - nat.find(([t]) => t === 'え')![1]).toBeCloseTo(2, 2);
    expect(at('お') - at('え')).toBeCloseTo(10, 3);
  });
  it('和字だけの行は、字間を均等に空ける (四分アキまで。越える分も均等)', () => {
    const xs = firstXs(52, 'あいうえおかき');
    // 5 字 (50pt) を 52pt に: 4 か所の字間に 0.5pt ずつ
    expect(xs.map(([t]) => t).join('')).toBe('あいうえお');
    expect(xs[4][1] - xs[0][1]).toBeCloseTo(42, 2);
  });
});

describe('和字の字間は詰めない', () => {
  const firstLineText = (t: ReturnType<typeof E.engine.layout>) => {
    const gl: GlyphArea[] = [];
    walk(kids(t)[0].children[0] as LineArea, (x) => x.type === 'glyph' && gl.push(x));
    return gl.map((g) => g.text).join('');
  };
  it('ベタ組の和字どうしの字間は追込みに使わない (JLREQ §3.8.3 の詰める箇所に含まれない) ので、わずかにあふれる字も追い出す', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 59.6, textAlign: 'start', children: ['あいうえおかきく'] } as never]));
    expect(firstLineText(t)).toBe('あいうえお');
  });
});

describe('欧文の合字 (書体の liga)', () => {
  it('書体の liga で 1 つの字形になる並び (長いものから) を 1 単位にまとめる。書体が違う並びはまとめない', () => {
    // 書体の代わり: ffk・ff・fj を合字にする
    const LIG = new Set(['ffk', 'ff', 'fj']);
    const font = { fk: { layout: (s: string) => ({ glyphs: LIG.has(s) ? [0] : Array.from(s) }) } } as never;
    expect(ligatureUnits('ffk ff fj fx', () => font)).toEqual(['ffk', ' ', 'ff', ' ', 'fj', ' ', 'f', 'x']);
    expect(ligatureUnits('ffk', () => null)).toEqual(['f', 'f', 'k']);
    // 欧文の字でないものは調べない
    expect(ligatureUnits('あff', () => font)).toEqual(['あ', 'ff']);
  });
});

describe('Box モデルとページネーション', () => {
  it('マージン相殺: 兄弟は max、親子(先頭)も畳まれる', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', margin: { bottom: 10 }, height: 20, children: [] },
        { type: 'block', margin: { top: 20 }, height: 20, children: [] },
        { type: 'block', margin: { top: 5 }, children: [{ type: 'block', margin: { top: 12 }, height: 10, children: [] }] },
      ]),
    );
    const k = kids(t);
    expect(k[0].y).toBeCloseTo(0);
    expect(k[1].y).toBeCloseTo(40);
    expect(k[2].y).toBeCloseTo(72);
  });

  it('枠付きブロックのページ断片: 上罫は先頭のみ・下罫は末尾のみ、widows 2', () => {
    const t = E.engine.layout(doc([{ type: 'block', border: { width: 1, color: '#000' }, padding: 4, children: [lines(40)] }]));
    expect(t.sheets.length).toBeGreaterThan(2);
    const frs = t.sheets.map((s) => s.page.regionBody.children[0] as BlockArea);
    frs.forEach((b, i) => {
      expect(b.isContinuation).toBe(i > 0);
      expect(b.continuesOnNext).toBe(i < frs.length - 1);
      expect(!!b.border.top).toBe(i === 0);
      expect(!!b.border.bottom).toBe(i === frs.length - 1);
    });
    expect(frs[frs.length - 1].children.length).toBeGreaterThanOrEqual(2);
    expect(frs.reduce((a, b) => a + b.children.length, 0)).toBe(40);
  });

  it('縦書き: ブロックは右端から左へ積まれる', () => {
    const t = E.engine.layout(
      doc(
        [
          { type: 'block', width: 30, height: 100, children: ['縦'] },
          { type: 'block', width: 30, height: 100, children: ['書'] },
        ],
        'vertical-rl',
      ),
    );
    const k = kids(t);
    expect(k[0].x).toBeCloseTo(pt(80) - 30);
    expect(k[1].x).toBeCloseTo(pt(80) - 60);
  });

  it('強制改ページ: 連続指定は 1 回に畳まれ、末尾に空ページを作らない', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', breakAfter: 'page', children: ['a'] },
        { type: 'block', breakBefore: 'page', children: ['b'] },
        { type: 'block', breakAfter: 'page', children: ['c'] },
      ]),
    );
    expect(t.sheets.length).toBe(2);
  });

  it('keepTogether: 入らないブロックは丸ごと次ページへ', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', keepTogether: true, children: [lines(8)] },
        { type: 'block', keepTogether: true, children: [lines(6)] },
      ]),
    );
    expect(t.sheets.map((s) => (s.page.regionBody.children as BlockArea[]).map((c) => c.children.length))).toEqual([[8], [6]]);
  });
});

describe('ルビ', () => {
  it('ルビが空きに収まらない行だけ行間が広がる', () => {
    const mk = (r: boolean) =>
      doc([{ type: 'block', lineHeight: 1.7, children: [r ? { type: 'ruby', baseText: '漢字', rubyText: 'かんじ' } : '漢字', 'あ\n', r ? { type: 'ruby', baseText: '漢字', rubyText: 'かんじ' } : '漢字', 'あ'] }]);
    const h = (r: boolean) => (kids(E.engine.layout(mk(r)))[0].children as LineArea[]).map((l) => +l.height.toFixed(2));
    expect(h(false)).toEqual([17, 17]);
    expect(h(true)).toEqual([18.5, 17]); // 5 - (17-10)/2 = 1.5 だけ 1 行目が拡張、2 行目は前行の余白で足りる
  });
});

describe('表', () => {
  const cell = (c: string[]) => ({ type: 'table-cell' as const, children: c });
  it('ヘッダ行を各ページに複製し、行は途中で分割しない', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ type: 'table-row' as const, cells: [cell([`${i}`]), cell(['x'])] }));
    const t = E.engine.layout(
      doc([
        {
          type: 'table',
          columns: [{ type: 'table-column', width: 40 }, { type: 'table-column', width: '1*' }],
          header: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell(['H']), cell(['H'])] }] },
          body: { type: 'table-body', rows },
        },
      ]),
    );
    expect(t.sheets.length).toBeGreaterThan(1);
    t.sheets.forEach((s, i) => {
      const tbl = s.page.regionBody.children[0] as unknown as { children: { isRepeatedHeader?: boolean }[]; isContinuation: boolean };
      expect(tbl.isContinuation).toBe(i > 0);
      if (i > 0) expect(tbl.children[0].isRepeatedHeader).toBe(true);
    });
  });
});

describe('fo:leader', () => {
  const toc = (title: string, no: string, extra: object = {}) => [title, { type: 'leader' as const, ...extra }, no];

  /** 行 area 内の全グリフの絶対位置 (行原点基準) を集める */
  const collect = (line: LineArea) => {
    const out: { text: string; x: number; y: number; w: number; h: number }[] = [];
    const rec = (a: any, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph') out.push({ text: a.text, x, y, w: a.width, h: a.height });
      for (const c of [...(a.children ?? []), ...(a.glyphs ?? []), ...(a.base ?? []), ...(a.ruby ?? [])]) rec(c, x, y);
    };
    for (const c of line.children) rec(c, 0, 0);
    return out;
  };

  it('目次: 見出しと頁番号の間を点で埋め、頁番号は行末に揃う (横書き)', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', width: 200, textAlign: 'justify', children: [...toc('第1章 組み織りの流儀', '12')] } as never,
        { type: 'block', width: 200, textAlign: 'justify', children: [...toc('第2章 縦書き', '148')] } as never,
      ]),
    );
    const bs = kids(t);
    const rows = bs.map((b) => collect(b.children[0] as LineArea));
    for (const r of rows) {
      const last = r[r.length - 1];
      expect(last.x + last.w).toBeCloseTo(200, 1); // 頁番号の右端 = 行末
      expect(r.filter((g) => g.text === '.').length).toBeGreaterThan(5);
    }
    // 点は行頭基準のピッチ位置 → 2 行で x が縦に揃う
    const dotsX = (r: typeof rows[0]) => r.filter((g) => g.text === '.').map((g) => Math.round((g.x + g.w / 2) * 100) / 100);
    const a = dotsX(rows[0]);
    const b = dotsX(rows[1]);
    const common = a.filter((x) => b.includes(x));
    expect(common.length).toBeGreaterThan(3);
  });

  it('頁番号は見出しと同じ行に留まる (leader の前後で改行しない)', () => {
    const t = E.engine.layout(
      doc([{ type: 'block', width: 90, children: [...toc('とても長い章の見出しがここに入ります', '99')] } as never]),
    );
    const b = kids(t)[0];
    const last = collect(b.children[b.children.length - 1] as LineArea).map((g) => g.text).join('');
    expect(last.endsWith('99')).toBe(true);
    expect(last.replace(/\./g, '').length).toBeGreaterThan(2); // 99 だけが孤立しない
  });

  it('CSS の leader(): 字が 1 つも入らなければ前の内容の後で改行し、leader と後ろの内容を次の行に置く (Content 3 §2.5.3)', () => {
    const items = (w: number) =>
      E.engine.layout(doc([{ type: 'block', width: w, children: ['とても長い章の見出しがここに入ります', '\u2005', { type: 'leader', cssLeader: true }, '\u200A', '99'] } as never]));
    for (const w of [80, 90, 100, 110, 120, 130]) {
      const b = kids(items(w))[0];
      const ls = b.children.map((l) => collect(l as LineArea).map((g) => g.text).join(''));
      // 後ろの内容 (99) は leader と同じ行にあり、その行には点が少なくとも 1 つある
      const last = ls[ls.length - 1];
      expect(last.endsWith('99')).toBe(true);
      expect(last).toContain('.');
      expect(ls.slice(0, -1).some((l) => l.includes('.'))).toBe(false);
    }
  });

  it('maximum で長さが頭打ちになり、空白を残す / rule は帯の領域になる', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', width: 200, textAlign: 'start', children: ['A', { type: 'leader', pattern: 'space', length: { maximum: 20 } }, 'B'] } as never,
        { type: 'block', width: 200, textAlign: 'start', children: ['A', { type: 'leader', pattern: 'rule', ruleThickness: 1, color: '#f00' }, 'B'] } as never,
      ]),
    );
    const [b0, b1] = kids(t);
    const [ga, gb] = collect(b0.children[0] as LineArea);
    expect(gb.x - (ga.x + ga.w)).toBeCloseTo(20, 1);
    const found: { w: number; h: number; bg?: string }[] = [];
    walk(b1, (n) => n.type === 'block' && n.backgroundColor === '#f00' && found.push({ w: n.width, h: n.height, bg: n.backgroundColor }));
    expect(found.length).toBe(1);
    expect(found[0].h).toBeCloseTo(1);
    expect(found[0].w).toBeGreaterThan(150);
  });

  it('縦書き: 点が上下に並び、頁番号が行末 (下端) に揃う', () => {
    const t = E.engine.layout(
      doc(
        [{ type: 'block', height: 200, textAlign: 'justify', children: [...toc('第一章', '十二')] } as never],
        'vertical-rl',
      ),
    );
    const b = kids(t)[0];
    const r = collect(b.children[0] as LineArea);
    const last = r[r.length - 1];
    expect(last.y + last.h).toBeCloseTo(200, 0);
    expect(r.filter((g) => g.text === '・' || g.text === '\u30fb').length).toBeGreaterThan(3);
  });
});

describe('回転 (reference-orientation)', () => {
  const rc = (extra: object = {}) => ({ type: 'block-container' as const, backgroundColor: '#eee', children: ['回転'], ...extra });
  const abs = (t: ReturnType<typeof E.engine.layout>) => t.sheets[0].page.absoluteAreas[0] as BlockArea;
  const page = { width: pt(100), height: pt(100) };

  it('絶対配置: width/height は回転前の寸法、位置は回転後の外接矩形 (right 指定は外接矩形の右端)', () => {
    const a = abs(E.engine.layout(doc([rc({ absolutePosition: true, rotation: 90, width: 100, height: 40, left: 10, top: 20 }) as never])));
    expect([a.width, a.height, a.orientation, a.x, a.y]).toEqual([100, 40, 90, 10, 20]);
    const b = abs(E.engine.layout(doc([rc({ absolutePosition: true, rotation: 90, width: 100, height: 40, right: 5, top: 20 }) as never])));
    expect(b.x).toBeCloseTo(page.width - 5 - 40); // 外接矩形の幅 = 回転前の高さ
    const c = abs(E.engine.layout(doc([rc({ absolutePosition: true, rotation: 180, width: 100, height: 40, right: 5, top: 20 }) as never])));
    expect(c.x).toBeCloseTo(page.width - 5 - 100); // 180° は入れ替わらない
  });

  it('絶対配置のコンテナも角丸・影を持つ (余白の箱の border-radius)', () => {
    const r = { rx: 0, ry: 0, corners: [[5, 5], [0, 0], [0, 0], [5, 5]] };
    const a = abs(E.engine.layout(doc([rc({ absolutePosition: true, width: 40, height: 60, left: 10, top: 20, borderRadius: r }) as never])));
    expect(a.borderRadius).toEqual(r);
  });

  it('通常フロー: 外接矩形の高さ (= 回転前の幅) だけブロック方向を消費し、幅の既定は中身の長さ (本文領域の高さが上限)', () => {
    const t = E.engine.layout(doc([rc({ rotation: 90, width: 100, height: 40 }) as never, { type: 'block', children: ['次'] } as never]));
    const [r, n] = t.sheets[0].page.regionBody.children as BlockArea[];
    expect(r.orientation).toBe(90);
    expect(n.y).toBeCloseTo(100);
    // 中身が短ければ、その長さ (「回転」2 字 = 20pt)
    const d = E.engine.layout(doc([rc({ rotation: 270, height: 30 }) as never]));
    expect((d.sheets[0].page.regionBody.children[0] as BlockArea).width).toBeCloseTo(20, 0);
    // 中身が長ければ、本文領域の高さまで
    const long = E.engine.layout(doc([rc({ rotation: 270, height: 30, children: ['回転'.repeat(40)] }) as never]));
    expect((long.sheets[0].page.regionBody.children[0] as BlockArea).width).toBeCloseTo(pt(80));
  });

  it('本文領域の回転: 局所寸法 (縦横入れ替え) で組み、RegionBodyArea に rotation が付く', () => {
    const d = doc([{ type: 'block', children: [lines(3)] } as never]);
    d.sequences[0].master = master({ width: 100, height: 140, bodyRotation: 90 });
    const rb = E.engine.layout(d).sheets[0].page.regionBody;
    expect(rb.orientation).toBe(90);
    expect(rb.width).toBeCloseTo(pt(120)); // 回転前の幅 = 本文領域の高さ (140 - 20)
    expect(rb.height).toBeCloseTo(pt(80));
    const line = (rb.children[0] as BlockArea).children[0] as LineArea;
    expect(line.width).toBeCloseTo(pt(120));
  });

  it('display-align (blockAlign): 固定の高さの中で内容を中央・末尾へ', () => {
    const y = (blockAlign?: string) => {
      const a = abs(E.engine.layout(doc([rc({ absolutePosition: true, width: 60, height: 100, left: 0, top: 0, blockAlign, children: ['あ'] }) as never])));
      return (a.children[0] as LineArea).y;
    };
    expect(y('center')).toBeCloseTo((100 - 17) / 2, 0); // 12pt でなく 10pt × 1.7 = 17
    expect(y('end')).toBeCloseTo(100 - 17, 0);
    expect(y()).toBeCloseTo(0);
  });

  it('描画: 回転した箱は局所座標系への変換 (反時計回り) を通して描かれる', async () => {
    const { paintSheet, rotationMatrix } = await import('../src/paint');
    const t = E.engine.layout(doc([rc({ absolutePosition: true, rotation: 90, width: 100, height: 40, left: 10, top: 20 }) as never]));
    const calls: number[][] = [];
    const painter = {
      fillRect: () => {},
      drawGlyph: () => {},
      drawImage: () => {},
      strokeLine: () => {},
      clipRect: () => {},
      restore: () => {},
      transform: (m: number[], draw: () => void) => {
        calls.push(m);
        draw();
      },
    };
    paintSheet(t.sheets[0], painter as never);
    const sh = t.sheets[0];
    const m = calls[0];
    // 局所の左上 (0,0) は外接矩形の左下、局所の右 (u+) は上へ向かう
    const ox = sh.trimOrigin.x + 10;
    const oy = sh.trimOrigin.y + 20;
    const apply = (u: number, v: number) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
    expect(apply(0, 0)).toEqual([ox, oy + 100]);
    expect(apply(100, 0)).toEqual([ox, oy]); // 局所の右端 → 外接矩形の上端
    expect(apply(0, 40)).toEqual([ox + 40, oy + 100]); // 局所の下端 → 右
    expect(rotationMatrix(270, 0, 0, 100, 40)).toEqual([0, 1, -1, 0, 40, 0]);
  });

  it('立体の罫線の CMYK の色は、RGB に直してから明るく・暗くする (cmyk(1,1,0,0) の groove は #0000aa と #8080ff)', async () => {
    const { paintSheet } = await import('../src/paint');
    const side = { width: 4, color: 'cmyk(1,1,0,0)', style: 'groove' as const };
    const t = E.engine.layout(doc([{ type: 'block', width: 100, border: { top: side, bottom: side, left: side, right: side }, children: ['a'] } as never]));
    const colors = new Set<string>();
    const painter = {
      fillRect: (_x: number, _y: number, _w: number, _h: number, c: string) => colors.add(c),
      fillPath: (_p: unknown, c: string) => colors.add(c),
      strokePath: (_p: unknown, _w: number, c: string) => colors.add(c),
      drawGlyph: () => {},
      drawImage: () => {},
      strokeLine: () => {},
      clipRect: () => {},
      restore: () => {},
      transform: (_m: number[], draw: () => void) => draw(),
    };
    paintSheet(t.sheets[0], painter as never);
    expect(colors.has('#0000aa')).toBe(true);
    expect(colors.has('#8080ff')).toBe(true);
  });

  it('CSS の罫線 (symmetric) の破線は、辺の中央に対して対称に置き、上と下の辺は同じ位置に線を描く', async () => {
    const { paintSheet } = await import('../src/paint');
    const side = { width: 2, color: '#000000', style: 'dashed' as const, symmetric: true };
    const t = E.engine.layout(doc([{ type: 'block', width: 101, border: { top: side, bottom: side, left: side, right: side }, children: ['a'] } as never]));
    const rects: number[][] = [];
    const painter = {
      fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
      drawGlyph: () => {},
      drawImage: () => {},
      strokeLine: () => {},
      clipRect: () => {},
      restore: () => {},
      transform: (_m: number[], draw: () => void) => draw(),
    };
    paintSheet(t.sheets[0], painter as never);
    const horiz = rects.filter((r) => r[3] === 2 && r[2] > 0.5);
    const ys = [...new Set(horiz.map((r) => r[1]))].sort((a, b) => a - b);
    expect(ys.length).toBe(2);
    const xsAt = (y: number) => horiz.filter((r) => r[1] === y).map((r) => [+r[0].toFixed(3), +r[2].toFixed(3)]);
    expect(xsAt(ys[1])).toEqual(xsAt(ys[0]));
    // 左右対称: 最初の線と最後の線の長さが同じ
    const top = xsAt(ys[0]);
    expect(top[0][1]).toBeCloseTo(top[top.length - 1][1], 3);
  });

  it('縦書きの横倒し文字 (GlyphArea.rotation) は、箱の回転 (orientation) と混同されない', async () => {
    const { paintSheet } = await import('../src/paint');
    const t = E.engine.layout(doc([{ type: 'block', children: ['縦abc'] } as never], 'vertical-rl'));
    let glyphRot = 0;
    let transforms = 0;
    const painter = {
      fillRect: () => {},
      drawGlyph: (g: GlyphArea) => {
        if (g.rotation) glyphRot++;
      },
      drawImage: () => {},
      strokeLine: () => {},
      clipRect: () => {},
      restore: () => {},
      transform: (_m: number[], draw: () => void) => {
        transforms++;
        draw();
      },
    };
    paintSheet(t.sheets[0], painter as never);
    expect(glyphRot).toBe(3);
    expect(transforms).toBe(0);
  });
});

describe('画像 (fo:external-graphic)', () => {
  const assets = new AssetStore();
  assets.registerSize('img/wide.png', 200, 100); // 150×75pt
  let withAssets: LayoutEngine;
  beforeAll(() => {
    withAssets = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
  });
  const lineOf = (t: ReturnType<typeof E.engine.layout>) => (t.sheets[0].page.regionBody.children[0] as BlockArea).children[0] as LineArea;
  const imgs = (a: LineArea) => {
    const out: ImageArea[] = [];
    walk(a, (n) => n.type === 'image' && out.push(n));
    return out;
  };
  it('互換モードのセルの最小の幅: 印の付いた画像の前後では改行しない (Quirks Mode Standard §3.8)', () => {
    const firstCellWidth = (noWrap: boolean) => {
      const im = { type: 'image', src: 'img/wide.png', width: 40, height: 20, ...(noWrap ? { noWrapInCellMin: true } : {}) };
      const t = withAssets.layout(
        doc([
          {
            type: 'table',
            fitContent: true,
            columns: [{ type: 'table-column' }, { type: 'table-column' }],
            body: { type: 'table-body', rows: [{ type: 'table-row', cells: [{ type: 'table-cell', overflowWrap: 'normal', children: [im, ' ', im] }, { type: 'table-cell', children: ['長い文。'.repeat(80)] }] }] },
          },
        ] as never),
      );
      const cells: Area[] = [];
      walk(t.sheets[0].page.regionBody as unknown as Area, (a) => {
        if ((a as { type: string }).type === 'table-cell') cells.push(a);
      });
      return cells[0].width;
    };
    expect(firstCellWidth(false)).toBeLessThan(60);
    expect(firstCellWidth(true)).toBeGreaterThan(80);
  });
  it('scale-to-fit (枠の幅と高さ): 枠はそのまま、画像は縦横の比を保って枠に収める。scale-down-to-fit は本来の大きさを超えない', () => {
    const one = (img: object) => {
      const t = withAssets.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'img/wide.png', ...img }] }] as never));
      let im: ImageArea | undefined;
      let box: Area | undefined;
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type === 'image') im = a as ImageArea;
        if (a.type === 'block' && Math.abs(a.height - 120) < 0.01) box = a;
      });
      return { im: im!, box };
    };
    // 枠 300×120pt に、150×75pt の画像: 拡大して 192×96 ではなく、高さ 120 に合わせて 240×120
    const fit = one({ width: 300, height: 120, viewport: { width: 300, height: 120 } });
    expect(fit.box!.width).toBeCloseTo(300, 1);
    expect(fit.im.width).toBeCloseTo(240, 1);
    expect(fit.im.height).toBeCloseTo(120, 1);
    // scale-down-to-fit: 本来の大きさ (150×75) のほうが枠より小さいので、そのまま
    const down = one({ width: 300, height: 120, viewport: { width: 300, height: 120 }, fitLimit: { w: 'down', h: 'down' } });
    expect(down.im.width).toBeCloseTo(150, 1);
    expect(down.im.height).toBeCloseTo(75, 1);
    // scale-up-to-fit: 枠 (100×40) が本来の大きさより小さいので、本来の大きさのまま
    const up = one({ width: 100, height: 40, fitLimit: { w: 'up', h: 'up' } });
    expect(up.im.width).toBeCloseTo(150, 1);
  });
  /** line 原点基準の絶対位置を付けて、glyph / image を集める */
  const placed = (line: LineArea) => {
    const out: { a: GlyphArea | ImageArea; x: number; y: number }[] = [];
    const rec = (a: any, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph' || a.type === 'image') out.push({ a, x, y });
      for (const c of [...(a.children ?? []), ...(a.base ?? []), ...(a.ruby ?? [])]) rec(c, x, y);
    };
    for (const c of line.children) rec(c, 0, 0);
    return out;
  };

  it('自然なサイズ (96dpi の px → pt)、下端が基線に揃い、行の高さが画像に合わせて伸びる', () => {
    const t = withAssets.layout(doc([{ type: 'block', children: ['あ', { type: 'image', src: 'wide.png' }, 'い'] }]));
    const l = lineOf(t);
    const [im] = imgs(l);
    expect(im.width).toBeCloseTo(150);
    expect(im.height).toBeCloseTo(75);
    expect(im.missing).toBe(false);
    expect(l.height).toBeGreaterThan(75);
    const p = placed(l);
    const pi = p.find((q) => q.a.type === 'image')!;
    const pg = p.find((q) => q.a.type === 'glyph')!;
    // 画像の下端 = 文字の基線
    expect(pi.y + (pi.a as ImageArea).height).toBeCloseTo(pg.y + (pg.a as GlyphArea).baselineY, 1);
  });

  it('baseline-shift のある inline の中の画像も、その分ずらす (数式の画像を、基線から下の深さだけ下げる)', () => {
    const t = withAssets.layout(doc([{ type: 'block', children: ['あ', { type: 'inline', baselineShift: -10, children: [{ type: 'image', src: 'wide.png', width: 60 }] }, 'い'] }]));
    const p = placed(lineOf(t));
    const pi = p.find((q) => q.a.type === 'image')!;
    const pg = p.find((q) => q.a.type === 'glyph')!;
    expect(pi.y + (pi.a as ImageArea).height).toBeCloseTo(pg.y + (pg.a as GlyphArea).baselineY + 10, 1);
  });

  it('幅だけ指定すると縦横比を保ち、両方指定すると枠に収める (uniform)', () => {
    const a = imgs(lineOf(withAssets.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'wide.png', width: 60 }] }]))))[0];
    expect([a.width, a.height]).toEqual([60, 30]);
    const b = imgs(lineOf(withAssets.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'wide.png', width: 60, height: 60 }] }]))))[0];
    expect([b.width, b.height]).toEqual([60, 30]);
    const c = imgs(lineOf(withAssets.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'wide.png', width: 60, height: 60, scaling: 'non-uniform' }] }]))))[0];
    expect([c.width, c.height]).toEqual([60, 60]);
  });

  it('画像データが無ければプレースホルダ (60×40pt)', () => {
    const im = imgs(lineOf(E.engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'none.png' }] }]))))[0];
    expect(im.missing).toBe(true);
    expect([im.width, im.height]).toEqual([60, 40]);
  });

  it('縦書き: 字面の中央に置かれ、送りは画像の高さ', () => {
    const t = withAssets.layout(doc([{ type: 'block', children: ['あ', { type: 'image', src: 'wide.png', width: 40 }, 'い'] }], 'vertical-rl'));
    const l = lineOf(t);
    const im = imgs(l)[0];
    expect([im.width, im.height]).toEqual([40, 20]);
    const g = (l.children[0] as { children: GlyphArea[] }).children[0];
    const ox = (l.children[0] as { x: number }).x;
    expect(im.x + ox + im.width / 2).toBeCloseTo(l.width / 2, 0); // 行の中央
    void g;
  });

  it('AssetStore: url() の包み・先頭の ./・ファイル名 (basename) 一致で解決する', () => {
    const s = new AssetStore();
    s.registerSize('a/b/logo.png', 10, 10);
    expect(s.get("url('a/b/logo.png')")).toBeTruthy();
    expect(s.get('./a/b/logo.png')).toBeTruthy();
    expect(s.get('x/LOGO.png')).toBeTruthy();
    expect(s.get('other.png')).toBeUndefined();
  });
});

describe('inline-container', () => {
  const inl = (extra: object = {}, kids: unknown[] = [{ type: 'block', children: ['短い'] }]) => ({ type: 'inline-container' as const, children: kids, ...extra });
  const boxOf = (a: LineArea) => {
    let out: BlockArea | undefined;
    walk(a, (n) => {
      if (!out && n.type === 'block') out = n;
    });
    return out!;
  };
  const line = (t: ReturnType<typeof E.engine.layout>) => (t.sheets[0].page.regionBody.children[0] as BlockArea).children[0] as LineArea;

  it('shrink-to-fit: 内容の幅 (行幅が上限) になり、背景色を持てる', () => {
    const l = line(E.engine.layout(doc([{ type: 'block', children: ['前', inl({ backgroundColor: '#ccc' }) as never, '後'] }])));
    const b = boxOf(l);
    expect(b.backgroundColor).toBe('#ccc');
    expect(b.width).toBeCloseTo(20, 0); // 「短い」 = 2 字 × 10pt
  });

  it('inline-progression-dimension (width) 指定が優先され、箱の中で折り返す', () => {
    const l = line(E.engine.layout(doc([{ type: 'block', children: ['前', inl({ width: 30 }, [{ type: 'block', children: ['あいうえおかきくけこ'] }]) as never, '後'] }])));
    const b = boxOf(l);
    expect(b.width).toBeCloseTo(30);
    let n = 0;
    walk(b, (a) => a.type === 'line' && n++);
    expect(n).toBeGreaterThan(1); // 3 字ずつ折り返される
  });

  it('横書き: 最初の行の基線が周囲の文字の基線に揃う', () => {
    const l = line(E.engine.layout(doc([{ type: 'block', children: ['前', inl({}, [{ type: 'block', children: ['縦に長い', '\n', '二行目'] }]) as never, '後'] }])));
    const b = boxOf(l);
    const glyphs: GlyphArea[] = [];
    walk(l, (n) => n.type === 'glyph' && glyphs.push(n));
    const abs = (g: GlyphArea) => g;
    void abs;
    // 箱 (2 行) は、1 行目の基線を合わせるので、箱の上端は行内の文字より上にはみ出さず、下へ伸びる
    expect(b.height).toBeGreaterThan(17 * 1.5);
    expect(l.height).toBeGreaterThanOrEqual(b.height);
  });

  it('縦書きの行の中に置け、親と異なる書字方向の箱も組める', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['あ', inl({ writingMode: 'horizontal-tb' }, [{ type: 'block', children: ['ABC'] }]) as never, 'い'] }], 'vertical-rl'));
    const b = boxOf(line(t));
    expect(b.width).toBeGreaterThan(0);
    expect(b.writingMode).toBe('horizontal-tb');
  });
});

describe('float (fo:float)', () => {
  const W = pt(80); // 本文領域の幅
  const fl = (float: 'start' | 'end' | 'before', extra: object = {}) => ({
    type: 'float' as const,
    float,
    width: 80,
    height: 50,
    backgroundColor: '#ddd',
    children: ['図'],
    ...extra,
  });
  const para = (n = 30) => ({ type: 'block' as const, children: ['あいうえお'.repeat(n)] });
  const split = (t: ReturnType<typeof E.engine.layout>, sheet = 0) => {
    const ch = t.sheets[sheet].page.regionBody.children as BlockArea[];
    return { floats: ch.filter((c) => c.backgroundColor === '#ddd'), blocks: ch.filter((c) => c.backgroundColor !== '#ddd') };
  };
  const lineGeom = (b: BlockArea) => (b.children as LineArea[]).map((l) => ({ x: +l.x.toFixed(1), y: +l.y.toFixed(1), w: +l.width.toFixed(1) }));

  it('start: float と重なる行だけ、始端を進めて幅を縮める (行ごとに使える幅が変わる)', () => {
    const t = E.engine.layout(doc([fl('start', { margin: { right: 10 } }) as never, para() as never]));
    const { floats, blocks } = split(t);
    expect(floats.length).toBe(1);
    expect(floats[0].x).toBeCloseTo(0);
    const g = lineGeom(blocks[0]);
    // float 高 50 → 行 0〜2 (0-51) が重なる。占有 = 80 + 10
    for (const k of [0, 1, 2]) {
      expect(g[k].x).toBeCloseTo(90, 0);
      expect(g[k].w).toBeCloseTo(W - 90, 0);
    }
    expect(g[3].x).toBeCloseTo(0);
    expect(g[3].w).toBeCloseTo(W, 0);
  });

  it('end: 終端側を縮める (始端はそのまま)', () => {
    const t = E.engine.layout(doc([fl('end', { margin: { left: 10 } }) as never, para() as never]));
    const { floats, blocks } = split(t);
    expect(floats[0].x).toBeCloseTo(W - 80, 0);
    const g = lineGeom(blocks[0]);
    expect(g[0].x).toBeCloseTo(0);
    expect(g[0].w).toBeCloseTo(W - 90, 0);
    expect(g[3].w).toBeCloseTo(W, 0);
  });

  it('縦書き: start は上端に置かれ、行は下へずれる (inline 方向 = 縦)', () => {
    const t = E.engine.layout(doc([fl('start', { width: undefined, height: 80, margin: { bottom: 10 } }) as never, para() as never], 'vertical-rl'));
    const { floats, blocks } = split(t);
    expect(floats[0].y).toBeCloseTo(0);
    const g = lineGeom(blocks[0]);
    const hs = (blocks[0].children as LineArea[]).map((l) => l.height); // 縦書きの行の inline 長 = 高さ
    expect(g[0].y).toBeCloseTo(90, 0);
    expect(hs[0]).toBeCloseTo(W - 90, 0);
    expect(hs[hs.length - 1]).toBeCloseTo(W, 0);
  });

  it('before: すでに置かれた本文を押し下げてページ先頭へ置く', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: [lines(3)] } as never, fl('before', { height: 30 }) as never, { type: 'block', children: ['後'] } as never]));
    const { floats, blocks } = split(t);
    expect(floats[0].y).toBeCloseTo(0);
    expect(blocks[0].y).toBeCloseTo(30); // 先に置かれていた本文が下がる
    expect(blocks[1].y).toBeGreaterThan(blocks[0].y);
  });

  it('入らない float は次ページの先頭へ送られ、本文は止まらない', () => {
    const filler = { type: 'block' as const, children: [lines(11)] }; // 187pt / 226pt
    const t = E.engine.layout(doc([filler as never, fl('before', { height: 120 }) as never, { type: 'block', children: [lines(30, '続')] } as never]));
    expect(t.sheets.length).toBeGreaterThan(1);
    expect(split(t, 0).floats.length).toBe(0);
    const p2 = split(t, 1);
    expect(p2.floats.length).toBe(1);
    expect(p2.floats[0].y).toBeCloseTo(0);
    // 1 ページ目の残りには本文が続いている
    expect((split(t, 0).blocks as BlockArea[]).length).toBeGreaterThan(1);
  });

  it('clear: float の下まで進める', () => {
    const t = E.engine.layout(doc([fl('start', { height: 100 }) as never, { type: 'block', clear: 'start', children: ['次'] } as never]));
    const { blocks } = split(t);
    expect(blocks[0].y).toBeGreaterThanOrEqual(100 - 0.01);
  });

  it('狭い回り込みの横の、collapse の表の後の段落: 組版が止まらず、段落は float の下に来る', { timeout: 20000 }, () => {
    // float の横が 2 字ぶんより狭いので、段落は float の下まで進める。collapse の表の外枠のはみ出し (保留の余白から引く分) が
    // あっても、float の下端に届く (届かないと、同じ float に当たり続けて止まらない)
    const cell = { type: 'table-cell', children: [{ type: 'block', children: ['a'] }] };
    const table = { type: 'table', borderCollapse: 'collapse', border: { width: 1, color: '#000000' }, columns: [], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell] }] } };
    const t = E.engine.layout(doc([fl('start', { width: 215, height: 100 }) as never, table as never, { type: 'block', id: 'p', children: ['あいうえお'.repeat(3)] } as never]));
    const ch = t.sheets[0].page.regionBody.children as BlockArea[];
    const p = ch[ch.length - 1];
    expect(p.y).toBeGreaterThanOrEqual(100 - 0.01);
    expect((p.children as LineArea[])[0].width).toBeCloseTo(W, 0);
  });

  it('clear: collapse の表の後でも、float の下まで進める', () => {
    const cell = { type: 'table-cell', children: [{ type: 'block', children: ['a'] }] };
    const table = { type: 'table', borderCollapse: 'collapse', width: 100, margin: { left: 120 }, border: { width: 4, color: '#000000' }, columns: [], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell] }] } };
    const t = E.engine.layout(doc([fl('start', { height: 100 }) as never, table as never, { type: 'block', clear: 'start', children: ['次'] } as never]));
    const ch = t.sheets[0].page.regionBody.children as BlockArea[];
    expect(ch[ch.length - 1].y).toBeGreaterThanOrEqual(100 - 0.01);
  });

  it('2 つの start float は重ならずに積まれる', () => {
    const t = E.engine.layout(doc([fl('start', { height: 40 }) as never, fl('start', { height: 40 }) as never, para() as never]));
    const { floats } = split(t);
    expect(floats[1].y).toBeGreaterThanOrEqual(floats[0].y + floats[0].height - 0.01);
  });

  it('anchorIsContent の float は、直前のブロックの break-after の後 (次のページ) に置く', () => {
    // 同じ親ブロックの中で、break-after のある子ブロックの直後に float が来る (新しいブロックの枠を開かない)
    const t = E.engine.layout(doc([
      { type: 'block', children: [{ type: 'block', breakAfter: 'page', children: ['前'] }, fl('start', { anchorIsContent: true }), '本文'] } as never,
    ]));
    expect(t.sheets.length).toBe(2);
    expect(split(t, 0).floats).toHaveLength(0);
    expect(split(t, 1).floats).toHaveLength(1);
  });

  it('anchorIsContent の float だけを含むブロックは空にならず、前後の space は相殺されない (XSL-FO のアンカー)', () => {
    const t = (anchor: boolean) => {
      const r = E.engine.layout(doc([
        { type: 'block', margin: { top: 10, bottom: 10 }, children: [fl('start', anchor ? { anchorIsContent: true } : {})] } as never,
        { type: 'block', margin: { top: 10 }, children: ['あ'] } as never,
      ]));
      const { floats } = split(r);
      // 本文の最初の行の位置 (float の中の行は除く)
      const lines: number[] = [];
      const visit = (a: Area, oy: number) => {
        const yy = oy + a.y;
        if (a.type === 'line') lines.push(yy);
        if ((a as BlockArea).backgroundColor === '#ddd') return;
        for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, yy);
      };
      for (const c of r.sheets[0].page.regionBody.children) visit(c, 0);
      return { float: floats[0].y, line: lines[0] };
    };
    const css = t(false);
    const fo = t(true);
    // float はどちらも最初の space (10) の後ろ
    expect(fo.float).toBeCloseTo(css.float, 3);
    // CSS: 余白は 1 つに相殺 → 本文は float の上端と同じ高さ。XSL-FO: アンカーの後ろの余白 (10) の分だけ下
    expect(css.line).toBeCloseTo(css.float, 1);
    expect(fo.line).toBeCloseTo(css.line + 10, 1);
  });
});

describe('脚注 (fo:footnote)', () => {
  const fn = (text: string, extra: object = {}) => ({ type: 'footnote' as const, children: [text], ...extra });
  const footArea = (t: ReturnType<typeof E.engine.layout>, sheet: number) => {
    const rb = t.sheets[sheet].page.regionBody;
    const last = rb.children[rb.children.length - 1] as BlockArea;
    // 脚注領域 = 区切り線 (bg あり) を子に持つ最後のブロック
    return last && last.children.some((c) => c.backgroundColor) ? last : undefined;
  };
  const texts = (a: BlockArea) => {
    const g: string[] = [];
    walk(a, (n) => n.type === 'glyph' && g.push(n.text));
    return g.join('');
  };

  it('脚注領域は本文領域の下端に積まれ、参照記号は小さく持ち上がる', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['本文あ', fn('注の本文A'), 'い。', fn('注の本文B'), 'う。'] }]));
    const rb = t.sheets[0].page.regionBody;
    const fa = footArea(t, 0)!;
    expect(fa).toBeTruthy();
    expect(fa.y + fa.height).toBeCloseTo(rb.height, 1);
    expect(texts(fa)).toContain('1　注の本文A');
    expect(texts(fa)).toContain('2　注の本文B');
    const line = (rb.children[0] as BlockArea).children[0] as LineArea;
    const refs: GlyphArea[] = [];
    walk(line, (n) => n.type === 'glyph' && /^[12]$/.test(n.text) && refs.push(n));
    expect(refs.length).toBe(2);
    expect(refs[0].fontSize).toBeCloseTo(7); // 10 * 0.7
  });

  it('入らない脚注は参照行ごと次ページへ送られる', () => {
    const blocks = Array.from({ length: 13 }, (_, i) => ({ type: 'block' as const, children: i === 12 ? ['最終行', fn('脚注')] : [`行${i}`] }));
    const t = E.engine.layout(doc(blocks));
    expect(t.sheets.length).toBe(2);
    expect(footArea(t, 0)).toBeUndefined();
    expect(footArea(t, 1)).toBeTruthy();
    expect((t.sheets[0].page.regionBody.children as BlockArea[]).length).toBe(12);
  });

  it('入れ子のブロックを含む長い脚注も、中の行で分けて次ページへ続く (E-09)', () => {
    const nested = { type: 'footnote', children: [{ type: 'block', children: [lines(30, '甲')] }, { type: 'block', margin: { left: 10 }, children: [lines(30, '乙')] }] };
    const t = E.engine.layout(doc([{ type: 'block', children: ['本文', nested as never] }]));
    expect(t.sheets.length).toBeGreaterThan(1);
    const all: string[] = [];
    t.sheets.forEach((_, i) => {
      const fa = footArea(t, i);
      if (!fa) return;
      expect(fa.height).toBeLessThanOrEqual(t.sheets[i].page.regionBody.height + 0.1);
      walk(fa, (a) => {
        if (a.type === 'line') {
          let s = '';
          walk(a, (g) => {
            if (g.type === 'glyph') s += (g as GlyphArea).text;
          });
          all.push(s);
        }
      });
    });
    const body = all.filter((l) => /[甲乙]/.test(l));
    expect(body.length).toBe(60);
    expect(t.warnings.join()).not.toContain('脚注がページに収まらない');
  });

  it('縦書き: 脚注領域は本文領域の左端に縦組みで置かれる', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['本文', fn('縦書きの脚注')] }], 'vertical-rl'));
    const rb = t.sheets[0].page.regionBody;
    const fa = footArea(t, 0)!;
    expect(fa.x).toBeCloseTo(0, 1);
    expect(fa.height).toBeCloseTo(rb.height);
    expect(fa.width).toBeLessThan(rb.width / 3);
  });

  it('長すぎる脚注は行単位で次ページへ続く', () => {
    const body = lines(60, '注');
    const t = E.engine.layout(doc([{ type: 'block', children: ['本文', fn(body)] }]));
    expect(t.sheets.length).toBeGreaterThan(1);
    let total = 0;
    t.sheets.forEach((_, i) => {
      const fa = footArea(t, i);
      if (fa) {
        expect(fa.height).toBeLessThanOrEqual(t.sheets[i].page.regionBody.height + 0.1);
        total += (fa.children.filter((c) => !c.backgroundColor) as BlockArea[]).reduce((a, c) => a + (c.children[0] as BlockArea).children.length, 0);
      }
    });
    expect(total).toBe(60);
  });

  it('番号書式・開始番号・ラベル上書き', () => {
    const t = E.engine.layout(
      doc([{ type: 'block', children: ['あ', fn('甲'), 'い', fn('乙', { label: '※' })] }], 'horizontal-tb', {
        footnotes: { numberFormat: 'circled', startNumber: 3 },
      }),
    );
    const s = texts(footArea(t, 0)!);
    expect(s).toContain('③　甲');
    expect(s).toContain('※　乙');
  });

  it('labelPosition: outside は番号を本文の外にぶら下げ、inside は番号の後ろに空きを入れない', () => {
    /** 脚注領域の字の、領域の左端からの x */
    const glyphX = (a: BlockArea) => {
      const out: { text: string; x: number }[] = [];
      const rec = (n: any, ox: number) => {
        const x = ox + n.x;
        if (n.type === 'glyph') out.push({ text: n.text, x });
        for (const c of [...(n.children ?? []), ...(n.glyphs ?? [])]) rec(c, x);
      };
      for (const c of a.children) rec(c, 0);
      return out;
    };
    const out = E.engine.layout(
      doc([{ type: 'block', children: ['あ', fn('甲')] }], 'horizontal-tb', { footnotes: { labelSuffix: ')', labelPosition: 'outside', labelGapEm: 0.5, inset: { start: 20 }, style: { fontSize: 8 } } }),
    );
    const g = glyphX(footArea(out, 0)!);
    const body = g.find((x) => x.text === '甲')!;
    const close = g.find((x) => x.text === ')')!;
    expect(body.x).toBeCloseTo(20, 1);
    expect(close.x).toBeLessThan(body.x - 3.9); // 番号は本文の始めより 0.5em (4pt) 手前で終わる
    expect(texts(footArea(out, 0)!)).toBe('1)甲');
    const ins = E.engine.layout(doc([{ type: 'block', children: ['あ', fn('甲')] }], 'horizontal-tb', { footnotes: { labelSuffix: ')', labelPosition: 'inside' } }));
    expect(texts(footArea(ins, 0)!)).toBe('1)甲');
  });

  it('format (ページ番号と同じ書式) と、本体の footnote-citation の置き換え', () => {
    const t = E.engine.layout(
      doc([{ type: 'block', children: ['あ', { type: 'footnote', bodyLabel: false, children: [{ type: 'footnote-citation' }, ' 本文'] } as never] }], 'horizontal-tb', {
        footnotes: { format: 'Ⅰ', startNumber: 2 },
      }),
    );
    expect(texts(footArea(t, 0)!)).toContain('Ⅱ 本文');
  });

  it('表のセル・ブロックコンテナの中の脚注も、その行を置いたページの脚注領域へ積む (E-08)', () => {
    const cell = (c: unknown[]) => ({ type: 'table-cell', children: [{ type: 'block', children: c }] });
    const t = E.engine.layout(
      doc([
        { type: 'table', columns: [{ type: 'table-column' }, { type: 'table-column' }], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell(['セル', fn('表の注')]), cell(['右'])] }] } },
        { type: 'block-container', children: [{ type: 'block', children: ['箱', fn('箱の注')] }] },
      ] as never),
    );
    const s = texts(footArea(t, 0)!);
    expect(s).toContain('1　表の注');
    expect(s).toContain('2　箱の注');
    expect(t.warnings.join()).not.toContain('脚注はページ本文の直下');
  });

  it('表の行が入るかは、行の中の脚注の高さも数える (入らなければ行ごと次のページへ)', () => {
    const cell = (c: unknown[]) => ({ type: 'table-cell', children: [{ type: 'block', children: c }] });
    const fill = Array.from({ length: 12 }, () => ({ type: 'block', children: ['あ'] }));
    const t = E.engine.layout(
      doc([...fill, { type: 'table', columns: [{ type: 'table-column' }], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell(['セル', fn('表の注')])] }] } }] as never),
    );
    expect(t.sheets.length).toBe(2);
    expect(footArea(t, 0) ? texts(footArea(t, 0)!) : '').not.toContain('表の注');
    expect(texts(footArea(t, 1)!)).toContain('表の注');
    expect(t.warnings.join()).not.toContain('脚注がページに収まらない');
  });

  it('reset="page": ページごとに 1 から振り直す (組み直して確定する)', () => {
    // 1 ページ 13 行: 脚注 2 つ → 改ページ → 脚注 2 つ
    const t = E.engine.layout(
      doc([{ type: 'block', children: ['あ', fn('甲'), 'い', fn('乙')] }, { type: 'block', breakBefore: 'page', children: ['う', fn('丙'), 'え', fn('丁')] }], 'horizontal-tb', {
        footnotes: { reset: 'page' },
      }),
    );
    expect(texts(footArea(t, 0)!)).toContain('1　甲');
    expect(texts(footArea(t, 0)!)).toContain('2　乙');
    expect(texts(footArea(t, 1)!)).toContain('1　丙');
    expect(texts(footArea(t, 1)!)).toContain('2　丁');
  });

  it('段組のコンテナの中の脚注も番号を振り、ページの脚注領域へ積む', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['前', fn('甲')] }, { type: 'block-container', columns: { count: 2, gap: 10 }, children: [{ type: 'block', children: ['段', fn('乙')] }, { type: 'block', children: ['組'] }] }] as never));
    const s = texts(footArea(t, 0)!);
    expect(s).toContain('1　甲');
    expect(s).toContain('2　乙');
  });

  it('continueNumbering: 前の page-sequence の番号に続けて振る (指定が無ければ 1 から)', () => {
    const seqs = (opts: object) => {
      const a = doc([{ type: 'block', children: ['あ', fn('甲'), 'い', fn('乙')] }], 'horizontal-tb', { footnotes: opts });
      const b = doc([{ type: 'block', children: ['う', fn('丙')] }], 'horizontal-tb', { footnotes: opts });
      return E.engine.layout({ ...a, sequences: [...a.sequences, ...b.sequences] });
    };
    expect(texts(footArea(seqs({ continueNumbering: true }), 1)!)).toContain('3　丙');
    expect(texts(footArea(seqs({}), 1)!)).toContain('1　丙');
  });
});

describe('fo:marker / fo:retrieve-marker', () => {
  const mk = (text: string) => ({ type: 'marker' as const, className: 'c', children: [text] });
  const header = (position: string, boundary?: string) => ({
    type: 'block-container' as const,
    absolutePosition: true,
    top: 0,
    left: 0,
    width: 200,
    height: 20,
    children: [{ type: 'retrieve-marker' as const, className: 'c', position, boundary } as never],
  });
  // 1 ページ 13 行。章 A (1 + 20 行) → 章 B (1 + 20 行) = 4 ページ。B の見出しは 2 ページ目
  const flow = [
    { type: 'block' as const, children: [mk('A'), '見出しA'] },
    { type: 'block' as const, children: [lines(20)] },
    { type: 'block' as const, children: [mk('B'), '見出しB'] },
    { type: 'block' as const, children: [lines(20)] },
  ];
  const headers = (position: string, boundary?: string) => {
    const t = E.engine.layout(doc(flow as never, 'horizontal-tb', { staticContent: [header(position, boundary)] }));
    return t.sheets.map((s) => {
      const g: string[] = [];
      for (const a of s.page.absoluteAreas) walk(a, (n) => n.type === 'glyph' && g.push(n.text));
      return g.join('');
    });
  };

  it('last-including-carryover: 現ページで始まる最後のマーカー、無ければ前ページからの持ち越し', () => {
    expect(headers('last-including-carryover')).toEqual(['A', 'B', 'B', 'B']);
  });
  it('first-starting-within-page: そのページで始まるものだけ (持ち越さない)', () => {
    expect(headers('first-starting-within-page')).toEqual(['A', 'B', '', '']);
  });
  it('first-including-carryover: ページ先頭側のマーカーを優先', () => {
    expect(headers('first-including-carryover')).toEqual(['A', 'B', 'B', 'B']);
  });
  it('boundary: page では持ち越さない', () => {
    expect(headers('last-including-carryover', 'page')).toEqual(['A', 'B', '', '']);
  });

  it('ページをまたぐ段組の中のマーカーは、その段の行を置いたページに記録される', () => {
    const items = Array.from({ length: 60 }, (_, k) => ({ type: 'block' as const, children: [mk(`t${k}`), `t${k}`] }));
    const t = E.engine.layout(doc([{ type: 'block-container', columns: { count: 2, gap: 10 }, children: items }] as never, 'horizontal-tb', { staticContent: [header('first-including-carryover'), { ...header('last-including-carryover'), top: 20 }] }));
    const heads = t.sheets.map((sh) => {
      const g: string[][] = [];
      for (const a of sh.page.absoluteAreas) {
        const one: string[] = [];
        walk(a, (n) => n.type === 'glyph' && one.push(n.text));
        g.push(one);
      }
      return g.map((x) => x.join(''));
    });
    expect(t.sheets.length).toBeGreaterThan(1);
    // 1 ページ目は t0 から始まり、最後のページは t59 で終わる。ページごとに違う値で、前のページの最後の次から始まる
    expect(heads[0][0]).toBe('t0');
    expect(heads[heads.length - 1][1]).toBe('t59');
    for (let k = 1; k < heads.length; k++) expect(+heads[k][0].slice(1)).toBe(+heads[k - 1][1].slice(1) + 1);
  });
  it('ページをまたぐ段組の段は、始めの側の padding の内側から並べる (左右の padding が違っても)', () => {
    const items = Array.from({ length: 200 }, (_, k) => ({ type: 'block' as const, children: [`t${k}`] }));
    const t = E.engine.layout(doc([{ type: 'block-container', padding: { left: 40, right: 0 }, columns: { count: 2, gap: 10 }, children: items }] as never));
    expect(t.sheets.length).toBeGreaterThan(1);
    // 行の左端の、本文の内側の左端からの位置 (親の箱の位置・罫線・padding を足していく)
    const lineXs = (a: Area, ox: number, out: number[]) => {
      const x = ox + a.x;
      if (a.type === 'line') return out.push(x);
      const inner = x + (a.padding?.left ?? 0) + (a.border?.left?.width ?? 0);
      for (const c of (a as { children?: Area[] }).children ?? []) lineXs(c, inner, out);
    };
    for (const sh of t.sheets) {
      const xs: number[] = [];
      for (const c of (sh.page.regionBody as unknown as { children: Area[] }).children) lineXs(c, 0, xs);
      expect(Math.min(...xs)).toBeCloseTo(40, 1);
    }
  });
  it('セルの中の break-before: avoid の段組: 字の並びと一緒に次のページへ送り、目印のセルも残さず、送った先で段数どおりに釣り合わせる', () => {
    const items = Array.from({ length: 30 }, (_, k) => ({ type: 'block' as const, children: [`i${k}`] }));
    const row = {
      type: 'table-row' as const,
      cells: [
        { type: 'table-cell' as const, blockAlign: 'baseline' as const, children: ['M'] },
        { type: 'table-cell' as const, blockAlign: 'baseline' as const, children: ['head', { type: 'block-container' as const, keepWithPrevious: true, columns: { count: 3, gap: 10 }, children: items }] },
      ],
    };
    const table = { type: 'table' as const, columns: [{ type: 'table-column' as const, width: 20 }, { type: 'table-column' as const }], body: { type: 'table-body' as const, rows: [row] } };
    const textOf = (a: Area) => {
      const out: string[] = [];
      walk(a, (n) => n.type === 'glyph' && out.push(n.text));
      return out.join('');
    };
    let moved = 0;
    for (let nf = 0; nf < 40; nf++) {
      const fill = Array.from({ length: nf }, () => ({ type: 'block' as const, children: ['f'] }));
      const t = E.engine.layout(doc([...fill, table] as never));
      const pages = t.sheets.map((sh) => textOf(sh.page.regionBody as unknown as Area));
      const at = (s: string) => pages.findIndex((p) => p.includes(s));
      // 目印・字の並び・段組の先頭は同じページ
      expect(at('M')).toBe(at('head'));
      expect(at('head')).toBe(at('i0'));
      if (at('head') > 0 && !pages[at('head') - 1].includes('i')) moved++;
    }
    // 送られる場合が実際にあったこと
    expect(moved).toBeGreaterThan(0);
  });
  it('段組の釣り合わせた 1 行の高さは、行を分けずに実際に段へ組んで決める (全体の高さ ÷ 段数ではない)', () => {
    const textOf = (a: Area) => {
      const out: string[] = [];
      walk(a, (n) => n.type === 'glyph' && out.push(n.text));
      return out.join('');
    };
    // 1 ページに入る行の数と、1 行の高さ
    const probe = E.engine.layout(doc(Array.from({ length: 200 }, () => ({ type: 'block' as const, children: ['f'] })) as never));
    const perPage = textOf(probe.sheets[0].page.regionBody as unknown as Area).length;
    const lineH = probe.sheets[0].page.regionBody.height / perPage;
    // 7 行を 3 段に釣り合わせると 3 行の高さ (3/2/2)。残りは 2.5 行 (全体 ÷ 段数の 2.33 行より大きい)
    const fill = Array.from({ length: perPage - 3 }, () => ({ type: 'block' as const, children: ['f'] }));
    const items = Array.from({ length: 7 }, (_, k) => ({ type: 'block' as const, children: [`i${k}`] }));
    const t = E.engine.layout(doc([...fill, { type: 'block-container', margin: { top: lineH / 2 }, columns: { count: 3, gap: 10 }, children: items }] as never));
    const pages = t.sheets.map((sh) => textOf(sh.page.regionBody as unknown as Area));
    // 残りの 2 行に 3 段で 6 行を置き、残りの 1 行を次のページへ (全体を次のページへ送らない)
    expect(pages[0]).toContain('i0');
    expect(pages[0]).toContain('i5');
    expect(pages[1]).toContain('i6');
  });
  it('表ヘッダーの行だけをページの終わりに残さず、表ごと次のページへ送る (既定・keepHeaderWithBodyAh とも)', () => {
    const textOf = (a: Area) => {
      const out: string[] = [];
      walk(a, (n) => n.type === 'glyph' && out.push(n.text));
      return out.join('');
    };
    const probe = E.engine.layout(doc(Array.from({ length: 200 }, () => ({ type: 'block' as const, children: ['f'] })) as never));
    const perPage = textOf(probe.sheets[0].page.regionBody as unknown as Area).length;
    const cell = (t: string) => ({ type: 'table-cell' as const, children: [{ type: 'block' as const, children: [t] }] });
    const row = (t: string) => ({ type: 'table-row' as const, cells: [cell(t)] });
    const table = (ah: boolean) => ({
      type: 'table' as const,
      columns: [{ type: 'table-column' as const, width: 100 }],
      header: { type: 'table-body' as const, rows: [row('H')] },
      body: { type: 'table-body' as const, rows: [row('B0'), row('B1')] },
      ...(ah ? { keepHeaderWithBodyAh: true } : {}),
    });
    const pagesOf = (ah: boolean) => {
      const fill = Array.from({ length: perPage - 1 }, () => ({ type: 'block' as const, children: ['f'] }));
      return E.engine.layout(doc([...fill, table(ah)] as never)).sheets.map((sh) => textOf(sh.page.regionBody as unknown as Area));
    };
    // 既定でも、表ヘッダーは本体の最初の行と同じページ (ヘッダーだけを前のページに残さない)
    const def = pagesOf(false);
    expect(def[0]).not.toContain('H');
    expect(def[1]).toContain('H');
    expect(def[1]).toContain('B0');
    // AH 互換も同じ
    const ah = pagesOf(true);
    expect(ah[0]).not.toContain('H');
    expect(ah[1]).toContain('H');
    expect(ah[1]).toContain('B0');
  });

  it('マーカーは内容が実際に置かれたページに記録される (改ページで後ろのページへ)', () => {
    const t = E.engine.layout(
      doc(
        [
          { type: 'block', children: [mk('A'), '本文'] },
          { type: 'block', breakBefore: 'page', children: [mk('B'), '次ページ'] },
        ] as never,
        'horizontal-tb',
        { staticContent: [header('first-starting-within-page')] },
      ),
    );
    const txt = t.sheets.map((s) => {
      const g: string[] = [];
      for (const a of s.page.absoluteAreas) walk(a, (n) => n.type === 'glyph' && g.push(n.text));
      return g.join('');
    });
    expect(txt).toEqual(['A', 'B']);
  });

  it('表のセル内のマーカーも、その行が置かれたページに記録される', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      type: 'table-row' as const,
      cells: [{ type: 'table-cell' as const, children: i === 25 ? [mk('T'), `${i}`] : [`${i}`] }],
    }));
    const t = E.engine.layout(
      doc([{ type: 'table', columns: [{ type: 'table-column' }], body: { type: 'table-body', rows } }] as never, 'horizontal-tb', {
        staticContent: [header('first-starting-within-page')],
      }),
    );
    const txt = t.sheets.map((s) => {
      const g: string[] = [];
      for (const a of s.page.absoluteAreas) walk(a, (n) => n.type === 'glyph' && g.push(n.text));
      return g.join('');
    });
    expect(txt.filter((x) => x === 'T').length).toBe(1);
    expect(txt.indexOf('T')).toBeGreaterThan(0);
  });
});

describe('空の断片を残さない', () => {
  it('罫線つきブロックの最初の行が次ページへ送られたら、前ページに罫線だけの断片を残さない', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', children: [lines(13)] }, // 221pt / 226.77pt: 次の 1 行は入らない
        { type: 'block', border: { width: 1, color: '#000' }, padding: 4, children: [lines(3)] },
      ]),
    );
    expect(t.sheets.length).toBe(2);
    expect(t.sheets[0].page.regionBody.children.length).toBe(1);
    const b = t.sheets[1].page.regionBody.children[0] as BlockArea;
    expect(b.isContinuation).toBe(false); // 2 ページ目が最初の断片 (上罫つき)
    expect(b.border.top).toBeTruthy();
    expect(b.y).toBeCloseTo(0);
  });

  it('表の最初の行が次ページへ送られたら、外枠だけの空の表を残さない', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ type: 'table-row' as const, cells: [{ type: 'table-cell' as const, children: [lines(2, `r${i}`)] }] }));
    const t = E.engine.layout(
      doc([
        { type: 'block', children: [lines(12)] },
        { type: 'table', border: { top: { width: 1, color: '#000' }, bottom: { width: 1, color: '#000' } }, columns: [{ type: 'table-column' }], body: { type: 'table-body', rows } },
      ]),
    );
    for (const s of t.sheets) for (const c of s.page.regionBody.children as BlockArea[]) expect(c.children.length).toBeGreaterThan(0);
  });
});

describe('表: 断片ごとに外枠を閉じる', () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({ type: 'table-row' as const, cells: [{ type: 'table-cell' as const, children: [lines(2, `r${i}-`)] }] }));
  const table = {
    type: 'table' as const,
    border: { top: { width: 1, color: '#000' }, right: { width: 1, color: '#000' }, bottom: { width: 1, color: '#000' }, left: { width: 1, color: '#000' } },
    columns: [{ type: 'table-column' as const }],
    body: { type: 'table-body' as const, rows },
  };
  type TableA = { border: Record<string, unknown>; y: number; x: number; width: number; height: number; isContinuation: boolean };

  it('横書き: 上端・下端の罫線がすべての断片に付き、断片はページに収まる', () => {
    const t = E.engine.layout(doc([table]));
    expect(t.sheets.length).toBeGreaterThan(1);
    t.sheets.forEach((s) => {
      const tb = s.page.regionBody.children[0] as unknown as TableA;
      expect(tb.border.top).toBeTruthy();
      expect(tb.border.bottom).toBeTruthy();
      expect(tb.y + tb.height).toBeLessThanOrEqual(s.page.regionBody.height + 0.1);
    });
  });

  it('縦書き: 右端 (block-start) と左端 (block-end) の罫線がすべての断片に付く', () => {
    const t = E.engine.layout(doc([table], 'vertical-rl'));
    expect(t.sheets.length).toBeGreaterThan(1);
    t.sheets.forEach((s) => {
      const tb = s.page.regionBody.children[0] as unknown as TableA;
      expect(tb.border.right).toBeTruthy();
      expect(tb.border.left).toBeTruthy();
      expect(tb.x).toBeGreaterThanOrEqual(-0.1);
      expect(tb.x + tb.width).toBeLessThanOrEqual(s.page.regionBody.width + 0.1);
    });
  });
});

describe('表: rowSpan', () => {
  const cell = (c: string[], extra: object = {}) => ({ type: 'table-cell' as const, children: c, ...extra });
  const cols = [{ type: 'table-column' as const, width: 50 }, { type: 'table-column' as const, width: '1*' as const }];
  type RowArea = { y: number; height: number; children: { x: number; y: number; width: number; height: number }[] };

  it('結合セルは該当行の高さの合計になり、後続行のセルは結合列を避けて配置される', () => {
    const t = E.engine.layout(
      doc([
        {
          type: 'table',
          columns: cols,
          body: {
            type: 'table-body',
            rows: [
              { type: 'table-row', cells: [cell(['A'], { rowSpan: 3 }), cell(['x'])] },
              { type: 'table-row', cells: [cell(['y'])] },
              { type: 'table-row', cells: [cell(['z'])] },
              { type: 'table-row', cells: [cell(['B']), cell(['w'])] },
            ],
          },
        },
      ]),
    );
    const rows = (t.sheets[0].page.regionBody.children[0] as unknown as { children: RowArea[] }).children;
    expect(rows.length).toBe(4);
    const span = rows[0].children[0];
    expect(span.height).toBeCloseTo(rows[0].height + rows[1].height + rows[2].height);
    expect(rows[1].children[0].x).toBeCloseTo(50); // 2 列目に入る
    expect(rows[3].children[0].x).toBeCloseTo(0); // 結合が終わった行は 1 列目から
  });

  it('結合内容の方が高ければ最終行が伸びる', () => {
    const t = E.engine.layout(
      doc([
        {
          type: 'table',
          columns: cols,
          body: {
            type: 'table-body',
            rows: [
              { type: 'table-row', cells: [cell([lines(6)], { rowSpan: 2 }), cell(['x'])] },
              { type: 'table-row', cells: [cell(['y'])] },
            ],
          },
        },
      ]),
    );
    const rows = (t.sheets[0].page.regionBody.children[0] as unknown as { children: RowArea[] }).children;
    const span = rows[0].children[0];
    expect(rows[0].height + rows[1].height).toBeCloseTo(span.height);
    expect(rows[1].height).toBeGreaterThan(rows[0].height);
  });

  it('rowSpan の塊はページをまたがない', () => {
    const body = Array.from({ length: 12 }, (_, i) => ({
      type: 'table-row' as const,
      cells: i % 3 === 0 ? [cell([`g${i}`], { rowSpan: 3 }), cell([lines(2)])] : [cell([lines(2)])],
    }));
    const t = E.engine.layout(doc([{ type: 'table', columns: cols, body: { type: 'table-body', rows: body } }]));
    expect(t.sheets.length).toBeGreaterThan(1);
    for (const s of t.sheets) {
      const rows = (s.page.regionBody.children[0] as unknown as { children: RowArea[] }).children;
      expect(rows.length % 3).toBe(0); // 3 行ずつの塊が割れていない
    }
  });

  it('1 ページに入らない rowSpan の塊は、またぐセルを行ごとに分けて (中身は最初の行)、行の境目でページをまたぐ', () => {
    const n = 40;
    const body = Array.from({ length: n }, (_, i) => ({
      type: 'table-row' as const,
      cells: i === 0 ? [cell(['分類'], { rowSpan: n }), cell([`行${i}`])] : [cell([`行${i}`])],
    }));
    const t = E.engine.layout(doc([{ type: 'table', columns: cols, body: { type: 'table-body', rows: body } }]));
    expect(t.warnings).toEqual([]);
    expect(t.sheets.length).toBeGreaterThan(1);
    const texts = (k: number) => {
      let s = '';
      walk(t.sheets[k].page.regionBody, (a) => {
        if (a.type === 'glyph') s += (a as GlyphArea).text;
      });
      return s;
    };
    expect(texts(0).startsWith('分類')).toBe(true);
    expect(t.sheets.slice(1).some((_, k) => texts(k + 1).includes('分類'))).toBe(false);
    // すべての行が、どこかのページに置かれる
    const all = t.sheets.map((_, k) => texts(k)).join('');
    for (let i = 0; i < n; i++) expect(all).toContain(`行${i}`);
    // 続きの行の左のセル (分けたセル) は、上下の罫線を持たない
    const rowsOf = (k: number) => (t.sheets[k].page.regionBody.children[0] as unknown as { children: RowArea[] }).children;
    const second = rowsOf(0)[1] as unknown as { children: Array<{ border?: Record<string, unknown> }> };
    expect(second.children[0].border?.top).toBeUndefined();
    expect(second.children[0].border?.bottom).toBeUndefined();
  });
});

describe('条件付きページマスター', () => {
  const m = (top: number) => master({ margins: { top, right: 10, bottom: 10, left: 10 } });
  const body = [{ type: 'block' as const, children: [lines(60)] }];

  it('first と rest で本文の幅が違えば、段落の続きを新しい幅で組み直す (E-14)', () => {
    const w = (left: number) => master({ margins: { top: 10, right: 10, bottom: 10, left } });
    const t = E.engine.layout(
      doc([{ type: 'block', textAlign: 'start', margin: { left: 5 }, border: { width: 1, color: '#000' }, children: ['あ'.repeat(600)] }] as never, 'horizontal-tb', {
        master: w(10),
        masterAlternatives: [{ when: { pagePosition: 'first' }, master: w(40) }],
      }),
    );
    expect(t.warnings).toEqual([]);
    const lineW = (k: number) => {
      const ws: number[] = [];
      walk(t.sheets[k].page.regionBody, (a) => {
        if (a.type === 'line') ws.push((a as LineArea).contentLength);
      });
      return Math.max(...ws);
    };
    const boxW = (k: number) => (t.sheets[k].page.regionBody.children[0] as BlockArea).width;
    expect(boxW(1) - boxW(0)).toBeCloseTo(pt(30), 0); // 2 ページ目の箱は 30mm 広い
    expect(lineW(1)).toBeGreaterThan(lineW(0) + pt(25)); // 行も広い幅で組む
    expect(lineW(1)).toBeLessThanOrEqual(boxW(1) - 7 + 0.1);
  });

  it('first / rest で本文領域の高さが変わる', () => {
    const t = E.engine.layout(
      doc(body, 'horizontal-tb', { master: m(10), masterAlternatives: [{ when: { pagePosition: 'first' }, master: m(40) }] }),
    );
    expect(t.sheets[0].page.regionBody.height).toBeCloseTo(pt(50));
    expect(t.sheets[1].page.regionBody.height).toBeCloseTo(pt(80));
    expect(t.warnings).toEqual([]);
  });

  it('odd / even で左右余白を入れ替える (ミラー余白)', () => {
    const mir = (l: number, r: number) => master({ margins: { top: 10, right: r, bottom: 10, left: l } });
    const t = E.engine.layout(
      doc(body, 'horizontal-tb', {
        master: mir(10, 10),
        masterAlternatives: [
          { when: { oddOrEven: 'odd' }, master: mir(20, 10) },
          { when: { oddOrEven: 'even' }, master: mir(10, 20) },
        ],
      }),
    );
    expect(t.sheets[0].page.regionBody.x).toBeCloseTo(pt(20));
    expect(t.sheets[1].page.regionBody.x).toBeCloseTo(pt(10));
    expect(t.sheets[2].page.regionBody.x).toBeCloseTo(pt(20));
  });

  it('last: 最終ページだけ別マスター (総ページ数が収束する)', () => {
    const t = E.engine.layout(
      doc(body, 'horizontal-tb', { master: m(10), masterAlternatives: [{ when: { pagePosition: 'last' }, master: m(10) , staticContent: [] }] }),
    );
    expect(t.sheets.length).toBeGreaterThan(1);
    expect(t.warnings).toEqual([]);
  });
});

describe('Latin font fallback', () => {
  it('Latin は代替ファミリ、CJK は元のフォントで計測する', async () => {
    const { fonts, measurer } = await makeEngine();
    const buf = fonts.get(FAMILY, 400).buffer;
    await fonts.registerBuffer('Alias Latin', 400, buf, false);
    fonts.setLatinFallback(FAMILY, 'Alias Latin');
    expect(fonts.getForChar(FAMILY, 400, 'A').family).toBe('Alias Latin');
    expect(fonts.getForChar(FAMILY, 400, 'あ').family).toBe(FAMILY);
    const g = measurer.glyph('A', { fontFamily: FAMILY, fontWeight: 400, fontSize: 10 } as never, 'horizontal-tb');
    expect(g.font.family).toBe('Alias Latin');
  });
});

describe('段組', () => {
  const cols = (n = 2, gapMm = 10) => master({ columns: { count: n, gap: gapMm } });
  const colWidth = (n: number, gapMm: number) => (pt(80) - pt(gapMm) * (n - 1)) / n;
  const run = (children: never[], m = cols(), wm: 'horizontal-tb' | 'vertical-rl' = 'horizontal-tb') =>
    E.engine.layout(doc(children, wm, { master: m }));

  it('2 段: 第 1 段が埋まると第 2 段へ、両段が埋まると次ページへ', () => {
    const t = run([{ type: 'block', textAlign: 'start', children: [lines(150)] }] as never);
    expect(t.sheets.length).toBeGreaterThan(1);
    const body = kids(t, 0);
    expect(body).toHaveLength(2);
    expect(body[0].x).toBeCloseTo(0);
    expect(body[1].x).toBeCloseTo(colWidth(2, 10) + pt(10), 0);
    expect(body[0].width).toBeCloseTo(colWidth(2, 10), 0);
    // 段 2 は段 1 の続き (行番号が連続する)
    const nLines = (b: BlockArea) => {
      let n = 0;
      walk(b, (a) => {
        if (a.type === 'line') n++;
      });
      return n;
    };
    expect(nLines(body[0])).toBeGreaterThan(10);
    expect(nLines(body[1])).toBe(nLines(body[0])); // 150 行なら 2 段とも満杯 (同じ行数)
  });

  it('fill="balance": フローの末尾の段も釣り合わせる (E-13)', () => {
    const nLines = (b: BlockArea) => {
      let n = 0;
      walk(b, (a) => {
        if (a.type === 'line') n++;
      });
      return n;
    };
    const plain = kids(run([{ type: 'block', textAlign: 'start', children: [lines(12)] }] as never), 0);
    expect(plain).toHaveLength(1); // 既定: 1 段目から順に埋める
    const bal = kids(run([{ type: 'block', textAlign: 'start', children: [lines(12)] }] as never, master({ columns: { count: 2, gap: 10, fill: 'balance' } })), 0);
    expect(bal).toHaveLength(2);
    expect(Math.abs(nLines(bal[0]) - nLines(bal[1]))).toBeLessThanOrEqual(1);
  });

  it('3 段・段間 (column-gap) の位置', () => {
    const t = run([{ type: 'block', children: [lines(200)] }] as never, cols(3, 6));
    const body = kids(t, 0);
    expect(body).toHaveLength(3);
    expect(body[2].x).toBeCloseTo(2 * (colWidth(3, 6) + pt(6)), 0);
  });

  it('span="all" の直前の段は釣り合い、見出しは全段幅で段の下に置かれる', () => {
    const t = run([
      { type: 'block', textAlign: 'start', children: [lines(20)] },
      { type: 'block', span: 'all', children: ['見出し'] },
      { type: 'block', textAlign: 'start', children: [lines(4, '後')] },
    ] as never);
    const body = kids(t, 0);
    const colBlocks = body.filter((b) => b.width < pt(80) - 1);
    const heads = body.filter((b) => Math.abs(b.width - pt(80)) < 1);
    expect(heads).toHaveLength(1);
    const [a, b] = colBlocks.slice(0, 2);
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(pt(0) + 20); // 釣り合い (1 行 + 余裕)
    expect(b.height).toBeGreaterThan(0);
    // 見出しは段の下端以降
    expect(heads[0].y).toBeGreaterThanOrEqual(Math.max(a.y + a.height, b.y + b.height) - 0.5);
    // 見出しの後ろの本文も同ページ (その下) に置かれる
    expect(colBlocks.length).toBeGreaterThanOrEqual(4);
  });

  it('span="all" が改ページで始まるなら、直前のページの段は釣り合わせない (1 段目から詰める)', () => {
    const t = run([
      { type: 'block', textAlign: 'start', children: [lines(6)] },
      { type: 'block', span: 'all', breakBefore: 'page', children: ['見出し'] },
    ] as never);
    // 釣り合わせれば 3 行ずつ 2 段に分かれるが、6 行とも 1 段目に置く
    expect(kids(t, 0).filter((b) => b.width < pt(80) - 1)).toHaveLength(1);
  });

  it('縦書きでも段は inline 方向 (上下) に並ぶ', () => {
    const t = run([{ type: 'block', textAlign: 'start', children: [lines(150)] }] as never, cols(2, 10), 'vertical-rl');
    const body = kids(t, 0);
    expect(body).toHaveLength(2);
    expect(body[0].x).toBeCloseTo(body[1].x, 0); // 同じ右端
    expect(body[1].y).toBeGreaterThan(body[0].y);
  });
});

describe('段組: 脚注・前方 float は全段を貫くページ単位の領域', () => {
  const m = master({ columns: { count: 2, gap: 10 } });
  const abs = (b: BlockArea) => b;
  it('脚注はページ下端に本文幅いっぱいで置かれ、段はその上で終わる', () => {
    const t = E.engine.layout(
      doc(
        [
          {
            type: 'block',
            textAlign: 'start',
            children: [lines(8), { type: 'footnote', children: ['脚注本体'] }, lines(60, '続')],
          },
        ] as never,
        'horizontal-tb',
        { master: m },
      ),
    );
    const body = kids(t, 0).map(abs);
    const foot = body.find((b) => Math.abs(b.width - pt(80)) < 0.5)!;
    expect(foot).toBeTruthy();
    expect(foot.x).toBeCloseTo(0);
    const cols = body.filter((b) => b !== foot);
    for (const c of cols) expect(c.y + c.height).toBeLessThanOrEqual(foot.y + 0.5);
  });

  it('前方 float はページ上端に本文幅いっぱいで置かれ、段はその下から始まる', () => {
    const t = E.engine.layout(
      doc(
        [
          {
            type: 'block',
            textAlign: 'start',
            children: [lines(5), { type: 'float', float: 'before', children: [{ type: 'block', backgroundColor: '#00eeaa', children: ['前方フロート'] }] }, lines(60, '続')],
          },
        ] as never,
        'horizontal-tb',
        { master: m },
      ),
    );
    const body = kids(t, 0);
    const fl = body.find((b) => Math.abs(b.width - pt(80)) < 0.5)!;
    expect(fl).toBeTruthy();
    expect(fl.y).toBeCloseTo(0, 0);
    const cols = body.filter((b) => b !== fl);
    for (const c of cols) expect(c.y).toBeGreaterThanOrEqual(fl.y + fl.height - 0.5);
  });

  it('footnotePosition="column" なら脚注は段ごと (全幅の領域は無い)', () => {
    const t = E.engine.layout(
      doc(
        [{ type: 'block', textAlign: 'start', children: [lines(10), { type: 'footnote', children: ['脚注本体'] }] }] as never,
        'horizontal-tb',
        { master: { ...m, columns: { count: 2, gap: 10, footnotePosition: 'column' } } },
      ),
    );
    expect(kids(t, 0).filter((b) => Math.abs(b.width - pt(80)) < 0.5)).toHaveLength(0);
  });
});

describe('float の末尾の space-after', () => {
  // 前方 float の内容の末尾の space-after は、続く前方 float との間に空ける (XSL 1.1 §4.3.1: float の領域は参照領域ではない。
  // CSS 2.1 §10.6.7: float の高さは、最後の子の下の margin までを含む)
  it('前方 float を 2 つ並べると、内容の space-after ぶんの隙間が空く', () => {
    const fl = (c: string) => ({ type: 'float', float: 'before', children: [{ type: 'block', backgroundColor: c, margin: { bottom: 8 }, children: ['前方'] }] });
    const t = E.engine.layout(doc([{ type: 'block', children: ['本文', fl('#ff0000'), fl('#00ff00'), '本文'] }] as never));
    const found: Array<{ bg: string; y: number; h: number }> = [];
    const visit = (a: BlockArea, oy: number) => {
      const y = oy + a.y;
      if (a.backgroundColor) found.push({ bg: a.backgroundColor, y, h: a.height });
      for (const c of (a as unknown as { children?: BlockArea[] }).children ?? []) if (c.type === 'block') visit(c, y);
    };
    for (const c of t.sheets[0].page.regionBody.children as BlockArea[]) visit(c, 0);
    const r = found.find((f) => f.bg === '#ff0000')!;
    const g = found.find((f) => f.bg === '#00ff00')!;
    expect(g.y - (r.y + r.h)).toBeCloseTo(8, 1);
  });
});

describe('text-align-last / 罫線の線種 / keep-with-next', () => {
  const lineGlyphs = (t: ReturnType<typeof E.engine.layout>) => {
    const out: GlyphArea[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'glyph') out.push(a);
    });
    return out;
  };
  const absX = (t: ReturnType<typeof E.engine.layout>) => {
    // glyph の x は行からの相対。行 (inline) の x を足して本文領域内の位置にする
    const xs: number[] = [];
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph') xs.push(x + a.width);
      for (const c of (a as unknown as { children?: Area[]; glyphs?: Area[] }).children ?? []) visit(c, x);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
    return xs;
  };

  it('text-align-last=end / center: 最終行が右・中央に寄る (指定が無ければ両端揃えの最終行は先頭詰め)', () => {
    const W = pt(80);
    const mk = (extra: object) => E.engine.layout(doc([{ type: 'block', textAlign: 'justify', children: ['あいう'], ...extra }] as never));
    const none = Math.max(...absX(mk({})));
    const end = Math.max(...absX(mk({ textAlignLast: 'end' })));
    const center = Math.max(...absX(mk({ textAlignLast: 'center' })));
    expect(none).toBeLessThan(40);
    expect(end).toBeCloseTo(W, 0);
    expect(center).toBeCloseTo((W + 30) / 2, 0);
    void lineGlyphs;
  });

  it('罫線の線種: 実線は 1 本、点線・破線は分割、二重線は 2 本', async () => {
    const { paintSheet } = await import('../src/paint');
    const count = (style?: string) => {
      const t = E.engine.layout(doc([{ type: 'block', border: { top: { width: 3, color: '#000000', ...(style ? { style } : {}) } }, children: ['あ'] }] as never));
      let n = 0;
      const p = {
        fillRect: (_x: number, _y: number, w: number, h: number, c: string) => {
          if (c === '#000000' && h === 3 && w > 1) n++;
          else if (c === '#000000' && Math.abs(h - 1) < 0.01 && w > 1) n++;
          else if (c === '#000000' && h === 3 && w <= 1) n++;
        },
        // 点線は 1 つの図形 (fillPath) にまとめて描く: 点 (部分パスの始まり M) の数を数える
        fillPath: (path: Array<{ op: string }>, c: string) => {
          if (c === '#000000') n += path.filter((s) => s.op === 'M').length;
        },
        clipPath() {}, strokePath() {},
        drawGlyph() {}, drawImage() {}, transform: (_m: unknown, d: () => void) => d(), strokeLine() {}, clipRect() {}, restore() {},
      };
      paintSheet(t.sheets[0], p as never, { guides: false });
      return n;
    };
    expect(count()).toBe(1);
    expect(count('dotted')).toBeGreaterThan(10);
    expect(count('dashed')).toBeGreaterThan(5);
    expect(count('double')).toBe(2);
  });

  it('keep-with-next: 見出しだけがページ末に残らず、次の段落と一緒に次ページへ', () => {
    const mk = (kwn: boolean) =>
      E.engine.layout(
        doc([
          { type: 'block', textAlign: 'start', children: [lines(12)] },
          { type: 'block', textAlign: 'start', ...(kwn ? { keepWithNext: true } : {}), children: ['見出し'] },
          { type: 'block', textAlign: 'start', children: [lines(6, '本')] },
        ] as never),
      );
    const nLines = (t: ReturnType<typeof E.engine.layout>, k: number) => {
      let n = 0;
      walk(t.sheets[k].page.regionBody, (a) => {
        if (a.type === 'line') n++;
      });
      return n;
    };
    const a = mk(false);
    const b = mk(true);
    expect(nLines(a, 0)).toBe(13); // 見出しがページ末に残る
    expect(nLines(b, 0)).toBe(12); // 見出しは次ページへ
    expect(nLines(b, 1)).toBe(nLines(a, 1) + 1);
  });

  it('keep-with-next: 次が長い表 (試し組みは最初の行で打ち切る) や keep-together のブロックでも、見出しを次のブロックの先頭と同じページに置く', () => {
    const cell = (c: string[]) => ({ type: 'table-cell' as const, children: c });
    const rows = Array.from({ length: 120 }, (_, i) => ({ type: 'table-row' as const, cells: [cell([`${i}`]), cell(['x'])] }));
    const table = { type: 'table', columns: [{ type: 'table-column' }, { type: 'table-column' }], body: { type: 'table-body', rows } };
    const nLines = (t: ReturnType<typeof E.engine.layout>, k: number) => {
      let n = 0;
      walk(t.sheets[k].page.regionBody, (a) => {
        if (a.type === 'line') n++;
      });
      return n;
    };
    const mk = (next: object, kwn = true) =>
      E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: [lines(12)] }, { type: 'block', textAlign: 'start', ...(kwn ? { keepWithNext: true } : {}), children: ['見出し'] }, next] as never));
    // 見出しの後ろにページをまたぐ表: 見出しは表の最初の行と一緒に次ページへ
    expect(nLines(mk(table, false), 0)).toBe(13);
    expect(nLines(mk(table), 0)).toBe(12);
    expect(mk(table).sheets.length).toBe(mk(table, false).sheets.length);
    // 次が keep-together のブロック (まるごと次ページへ送られる): 見出しも一緒に次ページへ
    const together = { type: 'block', textAlign: 'start', keepTogether: true, children: [lines(6, '本')] };
    expect(nLines(mk(together, false), 0)).toBe(13);
    expect(nLines(mk(together), 0)).toBe(12);
    // 次が keep-together でページに入らないほど長いブロック: 改ページしても一緒には入らないので、見出しは残る
    const tooLong = { type: 'block', textAlign: 'start', keepTogether: true, children: [lines(40, '本')] };
    expect(nLines(mk(tooLong), 0)).toBe(13);
  });

  it('keep-with-next: 次が inline (字・画像) でも、続く inline の先頭と同じページに置く', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', textAlign: 'start', children: [lines(12)] },
        { type: 'block', textAlign: 'start', children: [{ type: 'block', textAlign: 'start', keepWithNext: true, children: ['見出し'] }, lines(6, '本')] },
      ] as never),
    );
    let n = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') n++;
    });
    expect(n).toBe(12); // 見出しは、続く行と一緒に次ページへ
  });

  it('space-after を残す指定 (retainSpaceAfter) の段落の最後の行は、その余白までページに入る場合だけ置く (XSL §4.3.1・§5.3.2)', () => {
    const onFirst = (extra: object) => {
      const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', margin: { bottom: 20 }, ...extra, children: [lines(13)] }, { type: 'block', textAlign: 'start', children: ['次'] }] as never));
      let n = 0;
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type === 'line') n++;
      });
      return n;
    };
    // 13 行でページがちょうど埋まる。下の余白は既定ではページの終わりで捨てるので 13 行とも入る
    expect(onFirst({})).toBe(13);
    // 残す指定なら、最後の行の後ろの 20pt が入らないので、最後の行は次のページへ
    expect(onFirst({ retainSpaceAfter: true })).toBeLessThan(13);
  });

  it('keep-with-next で次ページへ送った見出しの先頭の余白は、ページの先頭で捨てる (retain の余白は残す)', () => {
    const firstLineY = (extra: object) => {
      const t = E.engine.layout(
        doc([
          { type: 'block', textAlign: 'start', children: [lines(12)] },
          { type: 'block', textAlign: 'start', keepWithNext: true, margin: { top: 15 }, ...extra, children: ['見出し'] },
          { type: 'block', textAlign: 'start', children: [lines(6, '本')] },
        ] as never),
      );
      let y: number | undefined;
      const rec = (a: any, oy: number) => {
        if (y !== undefined) return;
        if (a.type === 'line') y = oy + a.y;
        else for (const c of a.children ?? []) rec(c, oy + a.y);
      };
      for (const c of (t.sheets[1].page.regionBody as any).children) rec(c, 0);
      return y!;
    };
    expect(firstLineY({})).toBeCloseTo(0, 3);
    expect(firstLineY({ retainSpaceBefore: true })).toBeCloseTo(15, 3);
  });

  it('alignByTextAlign の表は、固定の列の幅の合計が狭ければ、継承した text-align で寄せる', () => {
    const x = (textAlign: string, flag = true) => {
      const t = E.engine.layout(doc([{ type: 'block', textAlign, children: [{ type: 'table', ...(flag ? { alignByTextAlign: true } : {}), columns: [{ type: 'table-column', width: 100 }], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [{ type: 'table-cell', children: ['a'] }] }] } }] }] as never));
      let i: number | undefined;
      walk(t.sheets[0].page.regionBody, (a: any) => {
        if (i === undefined && a.type === 'table') i = a.x;
      });
      return i!;
    };
    const free = E.engine.layout(doc([{ type: 'block', children: ['a'] }] as never)).sheets[0].page.regionBody.width - 100;
    expect(x('start')).toBeCloseTo(0, 3);
    expect(x('center')).toBeCloseTo(free / 2, 3);
    expect(x('end')).toBeCloseTo(free, 3);
    expect(x('center', false)).toBeCloseTo(0, 3);
  });

  it('keep-with-next の次が keep-together のブロックなら、そのブロック全体が同じページに入るかで、見出しを送るか決める', () => {
    const mk = (together: boolean) =>
      E.engine.layout(
        doc([
          { type: 'block', textAlign: 'start', children: [lines(10)] },
          { type: 'block', textAlign: 'start', keepWithNext: true, children: ['見出し'] },
          { type: 'block', textAlign: 'start', ...(together ? { keepTogether: true } : {}), children: [lines(6, '本')] },
        ] as never),
      );
    const firstPageText = (t: ReturnType<typeof E.engine.layout>) => {
      let s = '';
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type === 'glyph') s += (a as GlyphArea).text;
      });
      return s;
    };
    expect(firstPageText(mk(false))).toContain('見出し'); // 本文の 1 行目が同じページに入るので送らない
    expect(firstPageText(mk(true))).not.toContain('見出し'); // 本文を分けずに送るので、見出しも送る
  });

  it('discardLeadingSpace: 最初のページの先頭でも space-before を捨てる (retain は残す)', () => {
    const y = (seq: object, extra: object = {}) => {
      const t = E.engine.layout(doc([{ type: 'block', margin: { top: 20 }, ...extra, children: ['あ'] }] as never, 'horizontal-tb', seq));
      let v: number | undefined;
      const rec = (a: any, oy: number) => {
        if (v !== undefined) return;
        if (a.type === 'line') v = oy + a.y;
        else for (const c of a.children ?? []) rec(c, oy + a.y);
      };
      for (const c of (t.sheets[0].page.regionBody as any).children) rec(c, 0);
      return v!;
    };
    expect(y({})).toBeCloseTo(20, 3);
    expect(y({ discardLeadingSpace: true })).toBeCloseTo(0, 3);
    expect(y({ discardLeadingSpace: true }, { retainSpaceBefore: true })).toBeCloseTo(20, 3);
  });

  it('positionInContainer の絶対配置は、祖先のブロックコンテナの内容の箱を基準に置く', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', children: ['前'] },
        { type: 'block-container', height: 100, margin: { left: 30 }, children: [{ type: 'block-container', absolutePosition: true, positionInContainer: true, top: 40, left: 10, width: 20, children: ['中'] }] },
      ] as never),
    );
    let at: { x: number; y: number } | undefined;
    let cont: { x: number; y: number } | undefined;
    const rec = (a: any, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph' && a.text === '中') at = { x, y };
      if (a.height === 100 && !cont) cont = { x, y };
      for (const c of a.children ?? []) rec(c, x, y);
    };
    rec(t.sheets[0].page.regionBody, 0, 0);
    expect(cont).toBeDefined();
    expect(at!.x - cont!.x).toBeCloseTo(10, 1);
    expect(at!.y - cont!.y).toBeGreaterThan(39);
    expect(at!.y - cont!.y).toBeLessThan(41 + 12);
  });

  it('keep-with-next が連なるとき: 並び全体と次のブロックの先頭が同じページに載るまで、並びごと次ページへ', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', textAlign: 'start', children: [lines(11)] },
        { type: 'block', textAlign: 'start', keepWithNext: true, children: ['見出し'] },
        { type: 'block', textAlign: 'start', keepWithNext: true, children: ['要旨'] },
        { type: 'block', textAlign: 'start', children: [lines(6, '本')] },
      ] as never),
    );
    let n = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') n++;
    });
    expect(n).toBe(11); // 見出しと要旨の両方が次ページへ (見出しだけがページ末に残らない)
  });

  it('keep-with-previous は直前のブロックの keep-with-next と同じ', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', textAlign: 'start', children: [lines(12)] },
        { type: 'block', textAlign: 'start', children: ['見出し'] },
        { type: 'block', textAlign: 'start', keepWithPrevious: true, children: [lines(6, '本')] },
      ] as never),
    );
    let n = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') n++;
    });
    expect(n).toBe(12);
  });
});

describe('text-align inside / outside', () => {
  const maxRight = (t: ReturnType<typeof E.engine.layout>, k: number) => {
    let r = 0;
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph') r = Math.max(r, x + a.width);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
    };
    for (const c of t.sheets[k].page.regionBody.children) visit(c, 0);
    return r;
  };
  const mk = (align: 'inside' | 'outside') =>
    E.engine.layout(
      doc([
        { type: 'block', textAlign: align, breakAfter: 'page', children: ['あいう'] },
        { type: 'block', textAlign: align, children: ['あいう'] },
      ] as never),
    );

  it('inside: 奇数ページは start (左)、偶数ページは end (右)', () => {
    const t = mk('inside');
    expect(maxRight(t, 0)).toBeLessThan(40);
    expect(maxRight(t, 1)).toBeCloseTo(pt(80), 0);
  });

  it('outside は inside の逆', () => {
    const t = mk('outside');
    expect(maxRight(t, 0)).toBeCloseTo(pt(80), 0);
    expect(maxRight(t, 1)).toBeLessThan(40);
  });
});

describe('罫線の重なり順', () => {
  it('親の罫線は、はみ出した子の背景・罫線より前面に描かれる', async () => {
    const { paintSheet } = await import('../src/paint');
    const t = E.engine.layout(
      doc([
        {
          type: 'block',
          border: { left: { width: 2, color: '#000001' }, right: { width: 2, color: '#000001' } },
          children: [{ type: 'block', margin: { left: -6, right: -6 }, backgroundColor: '#00ff00', children: ['あ'] }],
        },
      ] as never),
    );
    const order: string[] = [];
    const p = {
      fillRect: (_x: number, _y: number, _w: number, _h: number, c: string) => order.push(c),
      drawGlyph() {}, drawImage() {}, transform: (_m: unknown, d: () => void) => d(), strokeLine() {}, clipRect() {}, restore() {},
    };
    paintSheet(t.sheets[0], p as never, { guides: false });
    expect(order.lastIndexOf('#00ff00')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('#000001')).toBeGreaterThan(order.lastIndexOf('#00ff00'));
  });
});

describe('画像の倍率指定', () => {
  it('widthScale / heightScale は画像本来の大きさ (px × 0.75 pt) に対する倍率', () => {
    const assets = new AssetStore();
    assets.registerSize('img/wide.png', 200, 100); // 150×75pt
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
    const t = engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'wide.png', widthScale: 0.6, heightScale: 0.6 }] }]));
    const found: ImageArea[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'image') found.push(a);
    });
    expect(found[0].width).toBeCloseTo(150 * 0.6);
    expect(found[0].height).toBeCloseTo(75 * 0.6);
  });
});

describe('強制改ページの種類・ページ数の調整 (S-05)', () => {
  const pageNumbers = (t: ReturnType<typeof E.engine.layout>) => t.sheets.length;
  const linesOn = (t: ReturnType<typeof E.engine.layout>, k: number) => {
    let n = 0;
    walk(t.sheets[k].page.regionBody, (a) => {
      if (a.type === 'line') n++;
    });
    return n;
  };

  it('break-before=odd-page: 次の奇数ページへ (偶奇が合わなければ白ページを挟む)', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['1'] }, { type: 'block', breakBefore: 'odd-page', children: ['3'] }] as never));
    expect(pageNumbers(t)).toBe(3);
    expect(linesOn(t, 1)).toBe(0); // 2 ページ目は白ページ
    expect(linesOn(t, 2)).toBe(1);
  });

  it('break-before=even-page: 1 ページ目の次は 2 ページ目 (白ページなし)', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['1'] }, { type: 'block', breakBefore: 'even-page', children: ['2'] }] as never));
    expect(pageNumbers(t)).toBe(2);
  });

  it('break-before=column: 段組では次の段、段組でなければ次のページ', () => {
    const one = E.engine.layout(doc([{ type: 'block', children: ['a'] }, { type: 'block', breakBefore: 'column', children: ['b'] }] as never));
    expect(pageNumbers(one)).toBe(2);
    const two = E.engine.layout(doc([{ type: 'block', children: ['a'] }, { type: 'block', breakBefore: 'column', children: ['b'] }] as never, 'horizontal-tb', { master: master({ columns: { count: 2, gap: 5 } }) }));
    expect(pageNumbers(two)).toBe(1);
    expect(two.sheets[0].page.regionBody.children).toHaveLength(2); // 2 つの段
  });

  it('段組で break-before=page: 残りの段を空けて次のページへ', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['a'] }, { type: 'block', breakBefore: 'page', children: ['b'] }] as never, 'horizontal-tb', { master: master({ columns: { count: 2, gap: 5 } }) }));
    expect(pageNumbers(t)).toBe(2);
  });

  it('force-page-count=even / end-on-odd、initial-page-number=auto-odd', () => {
    const seqs = (a: object, b: object = {}) => ({
      type: 'document',
      sequences: [
        { type: 'page-sequence', master: master(), flow: { type: 'flow', children: [{ type: 'block', children: ['x'] }] }, ...a },
        { type: 'page-sequence', master: master(), flow: { type: 'flow', children: [{ type: 'block', children: ['y'] }] }, ...b },
      ],
    });
    expect(E.engine.layout(seqs({ forcePageCount: 'even' }) as never).sheets.length).toBe(3); // 2 + 1
    expect(E.engine.layout(seqs({ forcePageCount: 'end-on-odd' }) as never).sheets.length).toBe(2);
    // 次が initial-page-number=1 (奇数) なら、auto で最後のページを偶数に合わせる
    expect(E.engine.layout(seqs({}, { initialPageNumber: 1 }) as never).sheets.length).toBe(3);
    // 次が auto-odd (奇数から始まる) なら、auto で最後のページを偶数に合わせる (§7.27.6: 強制しないのは次が auto のときだけ)。
    // 白ページ 2 を足し、次は 3 から
    const t = E.engine.layout(seqs({}, { initialPageNumber: 'auto-odd' }) as never);
    expect(t.sheets.length).toBe(3);
    expect(t.sheets.map((s) => s.page.pageNumber)).toEqual([1, 2, 3]);
  });
});

describe('id を持つ要素の記録 (S-10)', () => {
  it('inline・表のセルの中の block の id も、page-number-citation で参照できる', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', children: ['参照 ', { type: 'page-number-citation', refId: 'in' }, ' / ', { type: 'page-number-citation', refId: 'cell' }] },
        { type: 'block', breakBefore: 'page', children: ['本文 ', { type: 'inline', id: 'in', children: ['ここ'] }] },
        {
          type: 'table',
          breakBefore: 'page',
          columns: [{ type: 'table-column' }],
          body: { type: 'table-body', rows: [{ type: 'table-row', cells: [{ type: 'table-cell', children: [{ type: 'block', id: 'cell', children: ['セル'] }] }] }] },
        },
      ] as never),
    );
    const text: string[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'glyph') text.push(a.text);
    });
    expect(text.join('').replace(/\s/g, '')).toContain('参照2/3');
    expect(t.warnings.join()).not.toContain('見つかりません');
  });
});

describe('vertical-lr (tb-lr): 行・ブロックを左から右へ積む', () => {
  it('2 つ目のブロックは 1 つ目の右に置かれ、1 行目は左端', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['あ'] }, { type: 'block', children: ['い'] }] as never, 'vertical-lr' as never));
    const [a, b] = kids(t, 0);
    expect(a.x).toBeCloseTo(0, 1);
    expect(b.x).toBeGreaterThan(a.x + a.width - 0.5);
  });
});

describe('keep の適用範囲 (S-08)', () => {
  const rowsTable = (n: number, keepAt: number, extra: object = {}) => ({
    type: 'table',
    columns: [{ type: 'table-column' }],
    body: {
      type: 'table-body',
      rows: Array.from({ length: n }, (_, k) => ({ type: 'table-row', ...(k === keepAt ? { keepWithNext: true } : {}), cells: [{ type: 'table-cell', children: [`行${k + 1}`] }] })),
    },
    ...extra,
  });
  const rowsOn = (t: ReturnType<typeof E.engine.layout>, k: number) => {
    let n = 0;
    walk(t.sheets[k].page.regionBody, (a) => {
      if (a.type === 'table-row') n++;
    });
    return n;
  };

  it('表の行の keep-with-next: 次の行と同じページへ', () => {
    // 1 ページ 13 行 (17pt) 入る。12 行目に keep-with-next を付けると、12・13 行目がまとまる → 13 行目が入るなら同じページ
    const base = E.engine.layout(doc([rowsTable(20, -1)] as never));
    const n0 = rowsOn(base, 0);
    const kept = E.engine.layout(doc([rowsTable(20, n0 - 1)] as never)); // ページ末の行に keep-with-next
    expect(rowsOn(kept, 0)).toBe(n0 - 1); // 最後の行は次の行と一緒に次ページへ
  });

  it('表の keep-together: 入らなければ表の前で改ページ', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: [lines(8)] }, rowsTable(6, -1, { keepTogether: true })] as never));
    expect(rowsOn(t, 0)).toBe(0);
    expect(rowsOn(t, 1)).toBe(6);
  });

  it('inline の noBreak (keep-together.within-line): 行の途中で分割しない', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['あ'.repeat(19), { type: 'inline', noBreak: true, children: ['いいいい'] }] }] as never));
    const lineTexts: string[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') {
        let s = '';
        walk(a, (g) => {
          if (g.type === 'glyph') s += g.text;
        });
        lineTexts.push(s);
      }
    });
    expect(lineTexts.some((s) => s.includes('いいいい'))).toBe(true);
  });
});

describe('余白の優先度 (XSL 1.1 §4.3.1, S-12)', () => {
  const gap = (a: object, b: object) => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['あ'], ...a }, { type: 'block', children: ['い'], ...b }] as never));
    const [x, y] = kids(t, 0);
    return y.y - (x.y + x.height);
  };
  it('同じ優先度なら大きい方 (従来どおり)', () => {
    expect(gap({ margin: { bottom: 10 } }, { margin: { top: 20 } })).toBeCloseTo(20);
  });
  it('優先度の高い方が勝つ (値が小さくても)', () => {
    expect(gap({ margin: { bottom: 5 }, spaceAfterPrecedence: 1 }, { margin: { top: 20 } })).toBeCloseTo(5);
  });
  it('force は合計され、force でない余白は捨てられる', () => {
    expect(gap({ margin: { bottom: 5 }, spaceAfterPrecedence: 'force' }, { margin: { top: 8 }, spaceBeforePrecedence: 'force' })).toBeCloseTo(13);
    expect(gap({ margin: { bottom: 30 } }, { margin: { top: 8 }, spaceBeforePrecedence: 'force' })).toBeCloseTo(8);
  });
});

describe('page-sequence-master の部分列 (§6.4.8, S-12)', () => {
  const m = (w: number) => master({ width: w });
  it('single → repeatable (maximum-repeats=2) → alternatives (blank は白ページ用) の順に使う', () => {
    const t = E.engine.layout({
      type: 'document',
      sequences: [
        {
          type: 'page-sequence',
          master: m(100),
          masterSequence: [
            { kind: 'single', masters: [{ when: {}, master: m(101) }] },
            { kind: 'repeatable', maxRepeats: 2, masters: [{ when: {}, master: m(102) }] },
            {
              kind: 'alternatives',
              masters: [
                { when: { blankOrNotBlank: 'blank' }, master: m(109) },
                { when: {}, master: m(103) },
              ],
            },
          ],
          flow: {
            type: 'flow',
            children: [
              { type: 'block', children: ['1'] },
              { type: 'block', breakBefore: 'page', children: ['2'] },
              { type: 'block', breakBefore: 'page', children: ['3'] },
              { type: 'block', breakBefore: 'page', children: ['4'] },
              { type: 'block', breakBefore: 'odd-page', children: ['5'] }, // 4 ページ目の次は 5 (奇数): 白ページは不要
              { type: 'block', breakBefore: 'odd-page', children: ['7'] }, // 次は 6 (偶数): 6 ページ目を白ページにして 7 へ
            ],
          },
        },
      ],
    } as never);
    const widths = t.sheets.map((s) => Math.round((s.trimBox.width * 25.4) / 72));
    expect(widths).toEqual([101, 102, 102, 103, 103, 109, 103]);
  });
});

describe('inline の罫線・余白 (文字を囲む枠)', () => {
  const frames = (t: ReturnType<typeof E.engine.layout>) => {
    const out: Array<{ x: number; w: number; sides: string }> = [];
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'block' && Object.keys(a.border ?? {}).length && a.width > 0) out.push({ x, w: a.width, sides: Object.keys(a.border).sort().join(',') });
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
    return out;
  };
  it('枠は文字の幅 + 余白 + 罫線ぶん。前後の文字は枠の外に置かれる', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['あ', { type: 'inline', border: { width: 1, color: '#000' }, padding: { left: 2, right: 2 }, children: ['いう'] }, 'え'] }] as never));
    const f = frames(t);
    expect(f).toHaveLength(1);
    expect(f[0].x).toBeCloseTo(10, 1); // 「あ」の直後
    expect(f[0].w).toBeCloseTo(20 + 2 * 2 + 2 * 1, 1);
    expect(f[0].sides).toBe('bottom,left,right,top');
  });
  it('行をまたぐ枠は、切れ目の側の罫線を描かない', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['あ'.repeat(18), { type: 'inline', border: { width: 1, color: '#000' }, children: ['いいいいいいいい'] }] }] as never));
    const f = frames(t);
    expect(f).toHaveLength(2);
    expect(f[0].sides).toBe('bottom,left,top');
    expect(f[1].sides).toBe('bottom,right,top');
  });
});

describe('追い込み: 行頭に置けない約物の長い連続 (E-18)', () => {
  const linesOf = (text: string, width = 100) => {
    const t = E.engine.layout(doc([{ type: 'block', width, textAlign: 'start', punctuationSqueeze: false, children: [text] }] as never));
    const out: Array<{ s: string; w: number }> = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type !== 'line') return;
      let s = '';
      walk(a, (g) => {
        if (g.type === 'glyph') s += (g as GlyphArea).text;
      });
      out.push({ s, w: (a as LineArea).contentLength });
    });
    return out;
  };
  it('分割点が無ければ、約物のアキを詰めて次の分割点まで押し込む', () => {
    const ls = linesOf('あ' + '」'.repeat(12) + 'い');
    expect(ls[0].s).toBe('あ' + '」'.repeat(12));
    expect(ls[0].w).toBeLessThanOrEqual(100 + 1e-6);
    expect(ls[1].s).toBe('い');
  });
  it('詰めても入らなければ、これまでどおり強制分割', () => {
    const ls = linesOf('a'.repeat(40));
    expect(ls.length).toBeGreaterThan(1);
  });
});

describe('約物の連続の詰め・和欧間アキ (E-17)', () => {
  const xs = (text: string, extra: object = {}) => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: [text], ...extra }] as never));
    const out: number[] = [];
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph') out.push(x);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
    return out;
  };
  it('」「 の間は二分 (全角 2 字分ではなく 1.5 字分の送り)', () => {
    const x = xs('あ」「い');
    expect(x[3] - x[0]).toBeCloseTo(25, 1); // あ(10) + 」(5) + 「(10)
  });
  it('（「 は始め括弧が続くので、後ろの字の前のアキを詰める', () => {
    const x = xs('（「あ');
    expect(x[2] - x[0]).toBeCloseTo(15, 1);
  });
  it('punctuationSpacing: 約物と約物でない字の間・終わり括弧類の後ろのアキを、指定の間隔にする', () => {
    // あ（い）、う: 既定は あ(10) （(10) い(10) ）(5) 、(10) う
    const d = xs('あ（い）、う');
    expect(d[5] - d[0]).toBeCloseTo(45, 1);
    // 0.25em: （ の前・、 の後ろは 2.5 ずつ狭く、）、 は 2.5 重なる
    const q = xs('あ（い）、う', { punctuationSpacing: 0.25 });
    expect(q[1] - q[0]).toBeCloseTo(7.5, 1);
    expect(q[4] - q[3]).toBeCloseTo(2.5, 1);
    expect(q[5] - q[4]).toBeCloseTo(7.5, 1);
    // 0.75em: それぞれ 2.5 ずつ広く
    const w = xs('あ（い）、う', { punctuationSpacing: 0.75 });
    expect(w[5] - w[0]).toBeCloseTo(52.5, 1);
    // 0.5em は既定と同じ
    expect(xs('あ（い）、う', { punctuationSpacing: 0.5 })).toEqual(d);
  });
  it('punctuationTrimEnd: 行末の終わり括弧類・句読点の後ろの二分アキを捨てる (右寄せでは字面が行の端に来る)', () => {
    // 幅 100 の右寄せ: 。 の字の位置 (アキを捨てなければ 90、捨てれば 95)
    const last = (extra: object) => xs('あいう。', { width: 100, textAlign: 'end', ...extra })[3];
    expect(last({})).toBeCloseTo(90, 1);
    expect(last({ punctuationTrimEnd: true })).toBeCloseTo(95, 1);
    // 幅 35: 「あいう。」(40) は、行末の 。 の後ろのアキ (5) を捨てれば 1 行に収まる
    const lines = (extra: object) => {
      const t = E.engine.layout(doc([{ type: 'block', width: 35, textAlign: 'start', children: ['あいう。'], ...extra }] as never));
      return (t.sheets[0].page.regionBody.children[0] as BlockArea).children.length;
    };
    // 捨てなくても、追込みで行末の 。 の後ろのアキを詰めて 1 行に収める (JLREQ §3.8.3)
    expect(lines({ hangingPunctuation: false })).toBe(1);
    expect(lines({ hangingPunctuation: false, punctuationTrimEnd: true })).toBe(1);
  });
  it('punctuationSqueeze=false なら詰めない', () => {
    const x = xs('あ」「い', { punctuationSqueeze: false });
    expect(x[3] - x[0]).toBeCloseTo(30, 1);
  });
  it('punctuationTrimStart: 行頭の全角の始め括弧の前の二分アキを詰める (字面を前へ寄せ、その分だけ行に多く入る)', () => {
    const plain = xs('（あいう）');
    const trim = xs('（あいう）', { punctuationTrimStart: true });
    expect(trim[0] - plain[0]).toBeCloseTo(-5, 1);
    expect(trim[1] - plain[1]).toBeCloseTo(-5, 1);
    // 幅 45: 詰めなければ「（あいう」(40) の後ろの「え」が溢れて 4 字、詰めれば「（」が 5 になって「え」まで 5 字入る
    const first = (extra: object) => {
      const t = E.engine.layout(doc([{ type: 'block', width: 45, textAlign: 'start', children: ['（あいうえおか'], ...extra }] as never));
      let n = 0;
      walk((t.sheets[0].page.regionBody.children[0] as BlockArea).children[0], (a) => a.type === 'glyph' && n++);
      return n;
    };
    expect(first({})).toBe(4);
    expect(first({ punctuationTrimStart: true })).toBe(5);
  });

  it('textAutospace: 和文と欧文・数字の間に四分アキ', () => {
    const a = xs('あA', { textAutospace: true });
    const b = xs('あA');
    expect(a[1] - b[1]).toBeCloseTo(2.5, 1);
    // アキの大きさ (textAutospaceWidth。CSS の text-autospace は 1/8)
    expect(xs('あA', { textAutospace: true, textAutospaceWidth: 0.125 })[1] - b[1]).toBeCloseTo(1.25, 1);
    // 全角の空白 (U+3000) は、textAutospaceIdeographicSpace (XSL-FO の axf:text-autospace) のときだけ和字として扱う
    expect(xs('1\u3000', { textAutospace: true, textAutospaceIdeographicSpace: true })[1] - xs('1\u3000')[1]).toBeCloseTo(2.5, 1);
    expect(xs('1\u3000', { textAutospace: true })[1] - xs('1\u3000')[1]).toBeCloseTo(0, 1);
  });
  it('textAutospace: 追込みでは和欧間の四分アキを八分アキまで詰める (JLREQ §3.8.3)', () => {
    const x = xs('あ1あ', { textAutospace: true });
    const lines = (d: number) => {
      const t = E.engine.layout(doc([{ type: 'block', width: x[2] - x[0] + 10 - d, textAlign: 'start', textAutospace: true, children: ['あ1あ'] }] as never));
      return (t.sheets[0].page.regionBody.children[0] as BlockArea).children.length;
    };
    // 2 つ目の「あ」までの幅より 2pt 狭い行: 四分アキ (2.5pt) 2 つを八分 (1.25pt) まで詰めれば 2.5pt 詰まるので入る
    expect(lines(2)).toBe(1);
    // 3pt 狭いと詰めきれないので追い出す
    expect(lines(3)).toBe(2);
  });
  const ruby = { type: 'ruby', baseText: '日', rubyText: 'にちよう' };
  /** glyph と ruby の領域の [種類, 絶対 x, 幅] */
  const boxes = (children: unknown[], extra: object = {}) => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children, ...extra }] as never));
    const out: Array<[string, number, number]> = [];
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph' || a.type === 'ruby') out.push([a.type, x, a.width]);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
    return out;
  };
  it('rubyOverhang: 親文字より長いルビを前後の仮名に掛ける (ルビ文字 1 字分まで)', () => {
    const off = boxes(['あ', ruby, 'い']);
    expect(off[2][1] - off[0][1]).toBeCloseTo(30, 1); // あ(10) + ルビの長さ(20)
    const on = boxes(['あ', ruby, 'い'], { rubyOverhang: true });
    expect(on[2][1] - on[0][1]).toBeCloseTo(20, 1); // 前後に 5pt ずつ掛ける
    expect(on[1][0]).toBe('ruby');
    expect(on[1][1] - on[0][1]).toBeCloseTo(5, 1); // ルビは「あ」の後ろ半分から
    expect(on[1][2]).toBeCloseTo(20, 1);
  });
  it('rubyOverhang: 漢字や行頭には掛けない', () => {
    const on = boxes([ruby, '漢'], { rubyOverhang: true });
    expect(on[0][1]).toBeGreaterThanOrEqual(-1e-6); // 行頭からはみ出さない
    expect(on[1][1] - on[0][1]).toBeCloseTo(20, 1); // 後ろの漢字にも掛けない
  });
  it('kerning: 欧文の字の組にフォントのカーニングを足す', () => {
    const a = xs('AVAV', { kerning: true });
    const b = xs('AVAV');
    expect(a[3] - a[0]).toBeLessThan(b[3] - b[0] - 0.1);
  });
});

describe('傍注 (marginal float) と inside / outside の float (E-06)', () => {
  it('傍注は本文の行幅を変えず、続けて置くと前の傍注の下に積まれる', () => {
    const note = (t: string) => ({ type: 'float', float: 'end', marginal: true, children: [{ type: 'block', margin: { left: -50, right: -50 }, textAlign: 'end', children: [t] }] });
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: [note('注1'), note('注2'), 'あ'.repeat(22)] }] as never));
    const body = t.sheets[0].page.regionBody.children as BlockArea[];
    const notes = body.filter((b) => b.type === 'block' && b.children.length && (b as unknown as { children: BlockArea[] }).children[0].x < 0);
    expect(notes).toHaveLength(2);
    expect(notes[1].y).toBeGreaterThanOrEqual(notes[0].y + notes[0].height - 0.5);
    // 本文の 1 行目は、行幅いっぱい (22 字 = 220pt が 1 行に入る)
    let lines = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') lines++;
    });
    expect(lines).toBeLessThanOrEqual(4); // 本文 1 行 + 注 2 行 (+ 余裕)
  });

  it('float="outside": 奇数ページは end (右)、偶数ページは start (左)', () => {
    const fl = { type: 'float', float: 'outside', width: 30, children: ['注'] };
    const t = E.engine.layout(doc([{ type: 'block', children: [fl, '本'] }, { type: 'block', breakBefore: 'page', children: [fl, '本'] }] as never));
    const floatX = (k: number) => (t.sheets[k].page.regionBody.children as BlockArea[]).find((b) => Math.abs(b.width - 30) < 1)!.x;
    expect(floatX(0)).toBeGreaterThan(100);
    expect(floatX(1)).toBeCloseTo(0, 0);
  });
});

describe('改行しない特殊な空白 (U+202F・U+2007)', () => {
  it('書体が持たなければ、決まった幅 (U+202F は 0.2em、U+2007 は数字の幅) の空白の字形で描き、前後で改行しない', async () => {
    const st = { fontFamily: FAMILY, fontSize: 10 } as never;
    const nn = E.measurer.glyph('\u202F', st, 'horizontal-tb');
    expect([nn.advance, nn.draw]).toEqual([2, ' ']);
    expect(E.measurer.glyph('\u2007', st, 'horizontal-tb').advance).toBeCloseTo(E.measurer.glyph('0', st, 'horizontal-tb').advance);
    // U+2005 (4 分の 1 em)・U+200A (髪の毛ほどの空白) も、書体が持たなければ決まった幅
    expect(E.measurer.glyph('\u2005', st, 'horizontal-tb').advance).toBeCloseTo(2.5);
    expect(E.measurer.glyph('\u200A', st, 'horizontal-tb').advance).toBeCloseTo(1);
    // U+202F は UAX #14 の GL (前後で改行しない。LB12)
    expect(lineBreakActions([0x61, 0x202f, 0x62]).slice(1)).toEqual(['×', '×']);
  });
});

describe('inline の外側の空き (inlineMargin)', () => {
  it('始端・終端に空白を置き、後ろの文字をその分ずらす', () => {
    const lastX = (extra: object) => {
      const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['あ', { type: 'inline', children: ['い'], ...extra }, 'う'] }] as never));
      const l = (t.sheets[0].page.regionBody.children[0] as BlockArea).children[0] as LineArea;
      return l.children[l.children.length - 1].x;
    };
    expect(lastX({ inlineMargin: { start: 7, end: 5 } }) - lastX({})).toBeCloseTo(12);
  });
});

describe('ブロックの明示の高さ', () => {
  it('height は内容の高さ: 上下の padding はその外に足す (box-sizing: border-box なら含める)', () => {
    const h = (extra: object) => (E.engine.layout(doc([{ type: 'block', height: 50, padding: { top: 5, bottom: 10 }, children: ['あ'], ...extra }] as never)).sheets[0].page.regionBody.children[0] as BlockArea).height;
    expect(h({})).toBeCloseTo(65);
    expect(h({ boxSizing: 'border-box' })).toBeCloseTo(50);
  });
});

describe('ページの背景を描く範囲 (backgroundArea)', () => {
  it('content: 背景色・背景画像はページの余白の内側に描く (既定は塗り足しを含む用紙全体)', async () => {
    const { paintSheet } = await import('../src/paint');
    const fills = (area?: 'content') => {
      const t = E.engine.layout(doc([{ type: 'block', children: ['あ'] }], 'horizontal-tb', { master: master({ backgroundColor: '#ff0000', ...(area ? { backgroundArea: area } : {}) }) }));
      const rects: number[][] = [];
      const p = { fillRect: (x: number, y: number, w: number, h: number, c: string) => c === '#ff0000' && rects.push([x, y, w, h]), drawGlyph() {}, drawImage() {}, transform: (_m: unknown, d: () => void) => d(), strokeLine() {}, clipRect() {}, restore() {} };
      paintSheet(t.sheets[0], p as never);
      return { r: rects[0], sheet: t.sheets[0] };
    };
    const whole = fills();
    // 用紙全体 (塗り足しが用紙そのもの) の背景は、紙の端の外へ 2pt ずつ伸ばして塗る (低い解像度で端の画素が薄く見えないように)
    expect(whole.r[0]).toBeCloseTo(-2);
    expect(whole.r[2]).toBeCloseTo(whole.sheet.bleedBox.width + 4);
    const inner = fills('content');
    expect(inner.r[0]).toBeCloseTo(inner.sheet.trimBox.x + pt(10));
    expect(inner.r[2]).toBeCloseTo(pt(80));
  });
});

describe('背景画像 (background-image, I-04)', () => {
  const count = (repeat?: string) => {
    const assets = new AssetStore();
    assets.registerSize('bg.png', 40, 20); // 30×15pt
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
    const t = engine.layout(doc([{ type: 'block', width: 90, height: 45, boxSizing: 'border-box', backgroundImage: { src: 'bg.png', ...(repeat ? { repeat } : {}) }, children: ['あ'] }] as never));
    let n = 0;
    const p = {
      fillRect() {},
      drawGlyph() {},
      drawImage: (a: ImageArea) => {
        if (a.src === 'bg.png') n++;
      },
      transform: (_m: unknown, d: () => void) => d(),
      strokeLine() {},
      clipRect() {},
      restore() {},
    };
    return import('../src/paint').then(({ paintSheet }) => {
      paintSheet(t.sheets[0], p as never, { guides: false });
      return n;
    });
  };
  it('repeat は範囲いっぱいに敷き詰め、no-repeat は 1 枚、repeat-x は 1 段', async () => {
    expect(await count()).toBe(9); // 90/30 × 45/15
    expect(await count('no-repeat')).toBe(1);
    expect(await count('repeat-x')).toBe(3);
  });
});

describe('行番号 (axf:line-number, I-04)', () => {
  const numbers = (t: ReturnType<typeof E.engine.layout>, sheet = 0) => {
    // 本文の段より前 (x < 0) に置いた字を、行ごと (y) にまとめる
    const out = new Map<number, { x: number; s: string }>();
    const visit = (a: Area, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph' && x < 0) {
        const k = Math.round(y);
        const e = out.get(k) ?? { x, s: '' };
        e.s += (a as GlyphArea).text;
        out.set(k, e);
      }
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x, y);
    };
    for (const c of t.sheets[sheet].page.regionBody.children) visit(c, 0, 0);
    return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  };
  const para = (lineNumber: object, n = 6) => ({ type: 'block', textAlign: 'start', lineNumber, children: ['あ'.repeat(22 * n)] });

  it('show の段落の行に、行の基線をそろえて番号を振る (数え始めから interval ごと: 1, 3, 5)', () => {
    const t = E.engine.layout(doc([para({ mode: 'show', interval: 2 })] as never));
    expect(numbers(t).map((v) => v.s)).toEqual(['1', '3', '5']);
    // 番号の右端は段の端にそろう (offset の既定は 0)
    const n = numbers(t)[0];
    expect(n.x).toBeLessThan(-3);
    expect(n.x).toBeGreaterThan(-8);
    const off = numbers(E.engine.layout(doc([para({ mode: 'show', interval: 2, offset: 6 })] as never)))[0];
    expect(off.x).toBeCloseTo(n.x - 6, 3);
  });

  it('縦書きの番号は、時計回りに 90° 寝かせて行頭の先 (上) に置く', () => {
    const t = E.engine.layout(doc([para({ mode: 'show' }, 2)] as never, 'vertical-rl'));
    const gs: GlyphArea[] = [];
    let minY = Infinity;
    const visit = (a: Area, oy: number) => {
      const y = oy + a.y;
      if (a.type === 'glyph' && /\d/.test((a as GlyphArea).text)) {
        gs.push(a as GlyphArea);
        minY = Math.min(minY, y);
      }
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, y);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
    expect(gs.map((g) => g.text)).toEqual(['1', '2']);
    expect(gs.every((g) => g.rotation === 90)).toBe(true);
    expect(minY).toBeLessThan(0); // 本文領域の上端より上
  });

  it('hide は数えるが出さない。none は数えない', () => {
    const t = E.engine.layout(doc([para({ mode: 'hide' }, 2), para({ mode: 'none' }, 2), para({ mode: 'show' }, 2)] as never));
    expect(numbers(t).map((v) => v.s)).toEqual(['3', '4']);
  });

  it('format と initial', () => {
    const t = E.engine.layout(doc([para({ mode: 'show', format: '01', initial: 7 }, 3)] as never));
    expect(numbers(t).map((v) => v.s)).toEqual(['07', '08', '09']);
  });
});

describe('改訂バー (axf:revision-bar-*, I-04)', () => {
  const bars = (t: ReturnType<typeof E.engine.layout>) =>
    (t.sheets[0].page.regionBody.children as BlockArea[]).filter((a) => a.border.left && a.width <= 3).map((a) => ({ x: a.x, y: a.y, h: a.height, c: a.border.left!.color }));
  it('inline の改訂バーは、その文字を含む行だけに引く', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['あ'.repeat(30), { type: 'inline', revisionBar: { color: '#f00', offset: 4 }, children: ['い'] }, 'あ'.repeat(30)] }] as never));
    const b = bars(t);
    expect(b).toHaveLength(1);
    expect(b[0].x).toBeCloseTo(-5, 1); // 段の端から offset + 太さ
    expect(b[0].y).toBeGreaterThan(5); // 2 行目
  });
  it('block の改訂バーは、続く段落をまたいで 1 本、both なら両側', () => {
    const t = E.engine.layout(doc([{ type: 'block', revisionBar: { color: '#00f', position: 'both' }, children: [{ type: 'block', spaceAfter: 10, children: ['あ'] }, { type: 'block', children: ['い'] }] }] as never));
    const b = bars(t);
    expect(b).toHaveLength(2);
    expect(b[0].h).toBeGreaterThan(30); // 2 行 + 段落の間
  });
});

describe('右から左の横組み (direction="rtl", S-04)', () => {
  const glyphs = (t: ReturnType<typeof E.engine.layout>) => {
    const out: Array<{ ch: string; x: number; y: number }> = [];
    const visit = (a: Area, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph') out.push({ ch: (a as GlyphArea).text, x, y });
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x, y);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c, 0, 0);
    return out;
  };
  it('行の右端から左へ並べ、欧文・数字の並びは左から右のまま', () => {
    const t = E.engine.layout(doc([{ type: 'block', direction: 'rtl', textAlign: 'start', children: ['אב AB 12 ג'] }] as never));
    const g = glyphs(t);
    const x = (ch: string) => g.find((v) => v.ch === ch)!.x;
    const W = (t.sheets[0].page.regionBody as unknown as { width: number }).width;
    expect(x('א') + 10).toBeGreaterThan(W - 12); // 最初の字は右端
    expect(x('ב')).toBeLessThan(x('א'));
    expect(x('A')).toBeLessThan(x('B')); // 欧文は左から右
    expect(x('1')).toBeLessThan(x('2'));
    expect(x('B')).toBeLessThan(x('1')); // 「AB 12」は 1 つの並び
    expect(x('ג')).toBeLessThan(x('A'));
  });
  it('複数行: 続きの行も右から始まり、text-align="end" は左に寄せる', () => {
    const t = E.engine.layout(doc([{ type: 'block', direction: 'rtl', textAlign: 'end', children: ['あ'] }] as never));
    expect(glyphs(t)[0].x).toBeLessThan(1);
  });
});

describe('line-height.conditionality (XSL §7.16.4)', () => {
  /** ページの最初の行の上端 (行の箱の y) と、字の上端 (字の箱の y) */
  const top = (extra: object) => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', lineHeight: 2, ...extra, children: ['あいう'] }] as never));
    let line: Area | undefined;
    let glyph: Area | undefined;
    const visit = (a: Area, oy: number) => {
      const y = oy + a.y;
      if (a.type === 'line' && !line) line = { ...a, y };
      if (a.type === 'glyph' && !glyph) glyph = { ...a, y };
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, y);
    };
    visit(t.sheets[0].page.regionBody, 0);
    return { line: line!, glyph: glyph! };
  };
  it('discard: ページ (参照領域) の最初の行の上の半行間を捨てて、字を領域の上端へ寄せる', () => {
    const keep = top({});
    const cut = top({ lineHeightDiscard: true });
    expect(cut.line.height).toBeLessThan(keep.line.height - 4);
    expect(cut.glyph.y).toBeLessThan(keep.glyph.y - 4);
  });
  it('line-stacking-strategy="line-height" では捨てない (半行間は行の矩形に含まれる。XSL §4.5 の Note)', () => {
    const keep = top({ lineStackingStrategy: 'line-height' });
    const cut = top({ lineStackingStrategy: 'line-height', lineHeightDiscard: true });
    expect(cut.line.height).toBeCloseTo(keep.line.height, 3);
  });
  it('ブロックコンテナ (参照領域) の最後の行の下の半行間も捨てる', () => {
    const h = (extra: object) => {
      const t = E.engine.layout(doc([{ type: 'block-container', children: [{ type: 'block', textAlign: 'start', lineHeight: 2, ...extra, children: ['あ'] }] }] as never));
      return (t.sheets[0].page.regionBody.children[0] as BlockArea).height;
    };
    // 字 10pt・行 20pt: 上下の半行間 (5pt ずつ) を捨てて 10pt
    expect(h({})).toBeCloseTo(20, 0);
    expect(h({ lineHeightDiscard: true })).toBeCloseTo(10, 0);
  });
  it('line-height.precedence が数なら、続く行の上下の半行間は大きい方だけ (§4.3.1)。force (既定) は足す', () => {
    const ys = (extra: object) => {
      const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', lineHeight: 2, ...extra, children: ['あ\nい\nう'] }] as never));
      const out: number[] = [];
      const visit = (a: Area, oy: number) => {
        const y = oy + a.y;
        if (a.type === 'glyph') out.push(y);
        for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, y);
      };
      visit(t.sheets[0].page.regionBody, 0);
      return out;
    };
    const f = ys({});
    const p = ys({ lineHeightPrecedence: 0 });
    // 字 10pt・行送り 20pt: force は字の間隔 20pt、数なら半行間 (5pt) が 1 つ減って 15pt
    expect(f[1] - f[0]).toBeCloseTo(20, 1);
    expect(p[1] - p[0]).toBeCloseTo(15, 1);
    expect(p[2] - p[1]).toBeCloseTo(15, 1);
    // line-stacking-strategy="line-height" では重ね合わせない
    const l = ys({ lineHeightPrecedence: 0, lineStackingStrategy: 'line-height' });
    expect(l[1] - l[0]).toBeCloseTo(20, 1);
  });
  it('行を囲むブロックに上・下の余白 (padding) があれば、行は参照領域の端に接しないので捨てない (§4.3.1)', () => {
    const t = E.engine.layout(
      doc([{ type: 'block-container', children: [{ type: 'block', textAlign: 'start', lineHeight: 2, lineHeightDiscard: true, padding: { top: 2, bottom: 2 }, children: ['あ'] }] }] as never),
    );
    // 行 20pt (半行間を捨てない) + 上下の padding 2pt ずつ
    expect((t.sheets[0].page.regionBody.children[0] as BlockArea).height).toBeCloseTo(24, 0);
  });
});

describe('baseline-shift と行の高さ (E-05)', () => {
  const lineHeights = (lineHeight: number, shift: 'super' | number) => {
    const t = E.engine.layout(
      doc([{ type: 'block', lineHeight, textAlign: 'start', children: ['あ'.repeat(22), 'い', { type: 'inline', baselineShift: shift, children: ['2'] }, '\n', 'う'] }] as never),
    );
    const hs: number[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') hs.push(a.height);
    });
    return hs;
  };
  it('上付きの字は、行の半分のアキに収まっても、その字の行の高さの領域をずらした量 (0.35 em) だけ行を広げる', () => {
    const [, l2, l3] = lineHeights(2, 'super');
    expect(l2).toBeCloseTo(l3 + 3.5, 3);
  });
  it('収まらないときは、はみ出す分だけ行を広げる', () => {
    const [, l2, l3] = lineHeights(1, 8);
    expect(l2).toBeGreaterThan(l3 + 7);
  });
});

describe('コンテナの中の段組 (E-10)', () => {
  const cols = (extra: object) => {
    const t = E.engine.layout(doc([{ type: 'block-container', columns: { count: 3, gap: 8, rule: { width: 1, color: '#00f' } }, children: [{ type: 'block', textAlign: 'start', children: ['あ'.repeat(60)] }], ...extra }] as never));
    const box = t.sheets[0].page.regionBody.children[0] as BlockArea;
    const columns = box.children.filter((c) => !c.backgroundColor) as BlockArea[];
    const rules = box.children.filter((c) => c.backgroundColor);
    return { box, columns, rules };
  };
  it('高さの指定が無ければ、段の高さを釣り合わせる', () => {
    const { box, columns, rules } = cols({});
    expect(columns).toHaveLength(3);
    const lines = columns.map((c) => c.children.length);
    expect(Math.max(...lines) - Math.min(...lines)).toBeLessThanOrEqual(1);
    expect(columns[1].x).toBeGreaterThan(columns[0].x + columns[0].width);
    expect(rules).toHaveLength(2);
    expect(box.height).toBeLessThan(60); // 1 段なら 60 字 ≒ 9 行
  });
  it('釣り合わせは最初の段をいちばん長くし、後の段は前の段より高くしない (高い行があっても、後ろの段が長くならない)', () => {
    const mk = (count: number, kids: object[]) => {
      const t = E.engine.layout(doc([{ type: 'block-container', columns: { count, gap: 8 }, children: kids }] as never));
      const box = t.sheets[0].page.regionBody.children[0] as BlockArea;
      return (box.children as BlockArea[]).map((c) => c.height);
    };
    const small = () => ({ type: 'block', fontSize: 10, children: ['小'] });
    const a = mk(2, [{ type: 'block', fontSize: 24, children: ['大'] }, ...Array.from({ length: 7 }, small)]);
    expect(a[1]).toBeLessThanOrEqual(a[0] + 0.5);
    // 3 段: 7 行は最小の高さ (3 行) で 3・3・1 (後の段ほど短いか同じ)
    const b = mk(3, Array.from({ length: 7 }, small));
    expect(b[0]).toBeGreaterThan(b[2] + 0.5);
    expect(b[1]).toBeLessThanOrEqual(b[0] + 0.5);
    expect(b[2]).toBeLessThanOrEqual(b[1] + 0.5);
  });
  it('高さの指定があれば順に埋め、段間罫は内容のある段の間だけ (all なら空の段とも)', () => {
    const { columns, rules } = cols({ height: 200 });
    expect(columns.filter((c) => c.children.length)).toHaveLength(1);
    expect(rules).toHaveLength(0);
    const all = E.engine.layout(doc([{ type: 'block-container', height: 200, columns: { count: 3, rule: { width: 1, color: '#00f' }, ruleDisplay: 'all' }, children: ['あ'] }] as never));
    expect((all.sheets[0].page.regionBody.children[0] as BlockArea).children.filter((c) => c.backgroundColor)).toHaveLength(2);
  });
});

describe('直交する書字方向のブロックのページ分割 (E-16)', () => {
  it('横書きのページの中の縦書きブロック: 行の長さはページの残り、入りきらない行は次ページへ', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['前'] }, { type: 'block', writingMode: 'vertical-rl', textAlign: 'start', children: ['縦'.repeat(2000)] }] as never));
    expect(t.sheets.length).toBeGreaterThan(1);
    const rb0 = t.sheets[0].page.regionBody;
    const frag0 = (rb0.children as BlockArea[]).find((b) => b.writingMode === 'vertical-rl')!;
    const frag1 = (t.sheets[1].page.regionBody.children as BlockArea[]).find((b) => b.writingMode === 'vertical-rl')!;
    expect(frag0.y + frag0.height).toBeLessThanOrEqual(rb0.height + 0.1); // ページの残りに収まる
    expect(frag0.width).toBeLessThanOrEqual(rb0.width + 0.1); // 親の幅まで
    expect(frag1.height).toBeGreaterThan(frag0.height); // 2 ページ目は全高
    let n = 0;
    t.sheets.forEach((sh) =>
      walk(sh.page.regionBody, (a) => {
        if (a.type === 'glyph' && (a as GlyphArea).text === '縦') n++;
      }),
    );
    expect(n).toBe(2000);
  });
});

describe('親と直交する書字方向の float (E-19)', () => {
  it('横書きの本文の中の縦書きの float: 端に置き、本文を回り込ませる', () => {
    const t = E.engine.layout(
      doc([{ type: 'block', textAlign: 'start', children: [{ type: 'float', float: 'end', writingMode: 'vertical-rl', width: 30, height: 60, children: ['縦書きの注'] }, 'あ'.repeat(80)] }] as never),
    );
    expect(t.warnings.join()).not.toContain('float');
    const rb = t.sheets[0].page.regionBody;
    const fl = (rb.children as BlockArea[]).find((b) => b.writingMode === 'vertical-rl')!;
    expect(fl).toBeTruthy();
    expect(fl.x + fl.width).toBeCloseTo(rb.width, 0); // end (右) 側
    expect(fl.width).toBeCloseTo(30, 0);
    expect(fl.height).toBeCloseTo(60, 0);
    // 回り込み: 最初の行は float の分だけ短い
    let first: LineArea | undefined;
    walk(rb, (a) => {
      if (a.type === 'line' && !first) first = a as LineArea;
    });
    expect(first!.contentLength).toBeLessThanOrEqual(rb.width - 30 + 0.1);
  });
});

describe('font-stretch (I-06)', () => {
  it('横書きの字幅を拡縮し、字形も水平に拡縮して描く', () => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', fontStretch: 0.75, children: ['あいう'] }] as never));
    const gs: GlyphArea[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'glyph') gs.push(a as GlyphArea);
    });
    expect(gs[1].x - gs[0].x).toBeCloseTo(7.5, 1);
    expect(gs[0].scaleX).toBeCloseTo(0.75);
  });
});

describe('inline-container の揃え (I-08)', () => {
  const box = (extra: object) => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['あ', { type: 'inline-container', width: 30, height: 40, children: ['い'], ...extra }, 'う'] }] as never));
    const areas: Area[] = [];
    walk(t.sheets[0].page.regionBody, (a) => areas.push(a));
    const b = areas.find((a) => a.type === 'block' && Math.abs(a.width - 30) < 0.01)!;
    const glyph = (ch: string) => areas.find((a) => a.type === 'glyph' && (a as GlyphArea).text === ch)!;
    return { b, inner: (b as BlockArea).children, a: glyph('あ') };
  };
  it('display-align: 固定の高さの中で内容を中央・末尾へ寄せる', () => {
    const top = box({}).inner[0].y;
    expect(box({ blockAlign: 'center' }).inner[0].y).toBeGreaterThan(top + 10);
    expect(box({ blockAlign: 'end' }).inner[0].y).toBeGreaterThan(box({ blockAlign: 'center' }).inner[0].y + 10);
  });
  it('alignment-baseline: before-edge は箱の上端を字面の上端に、after-edge は下端を字面の下端に', () => {
    const be = box({ alignmentBaseline: 'before-edge' });
    expect(be.b.y).toBeCloseTo(be.a.y, 0);
    const ae = box({ alignmentBaseline: 'after-edge' });
    expect(ae.b.y + ae.b.height).toBeCloseTo(ae.a.y + ae.a.height, 0);
  });
  it('baselineFrom="last": 最後の行の基線を周囲の基線に揃える (CSS の inline-block)', () => {
    // 2 行の箱の横の「あ」: 最初の行で揃えると 1 行目 (い) の高さ、最後の行で揃えると 2 行目 (う) の高さに来る
    const offset = (extra: object) => {
      const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['あ', { type: 'inline-container', width: 30, children: [{ type: 'block', children: ['い'] }, { type: 'block', children: ['う'] }], ...extra }] }] as never));
      const lineArea = (t.sheets[0].page.regionBody.children[0] as BlockArea).children[0] as LineArea;
      return (lineArea.children[0] as BlockArea).children[0].y;
    };
    expect(offset({ baselineFrom: 'last' })).toBeGreaterThan(offset({}) + 10);
  });
  it('block-container の blockAlign: space-between は、子の間に余りを等分する (最初は上端、最後は下端)', () => {
    const t = E.engine.layout(doc([{ type: 'block-container', height: 100, blockAlign: 'space-between', children: [{ type: 'block', children: ['上'] }, { type: 'block', children: ['下'] }] }] as never));
    const box = t.sheets[0].page.regionBody.children[0] as BlockArea;
    const [a, b] = box.children;
    expect(a.y).toBeCloseTo(0);
    expect(b.y + b.height).toBeCloseTo(100);
  });
  it('overflow="hidden" は切り抜く', () => {
    expect(box({ overflow: 'hidden' }).b.clip).toBe(true);
  });
  it('マージンは行の中の寸法に含める (上下は行を高くし、左右は前後の文字を離す)', () => {
    const lineOf = (extra: object) => {
      const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['あ', { type: 'inline-container', width: 30, height: 40, children: ['い'], ...extra }, 'う'] }] as never));
      const areas: Area[] = [];
      walk(t.sheets[0].page.regionBody, (a) => areas.push(a));
      const l = areas.find((a) => a.type === 'line') as LineArea;
      return { h: l.height, last: l.children[l.children.length - 1].x };
    };
    const p0 = lineOf({});
    const p1 = lineOf({ margin: { top: 10, bottom: 6, left: 8, right: 12 } });
    expect(p1.h).toBeCloseTo(p0.h + 16, 0);
    expect(p1.last - p0.last).toBeCloseTo(20, 0);
    // 箱そのものの大きさは変わらない
    expect(box({ margin: { top: 10, bottom: 6, left: 8, right: 12 } }).b.height).toBeCloseTo(40);
  });
});

describe('画像を置く枠 (viewport) と揃え', () => {
  it('枠の大きさの箱の中に、text-align / display-align で揃えて置く', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: [{ type: 'image', src: 'x.png', width: 40, height: 20, viewport: { width: 100, height: 60, align: 'center', blockAlign: 'end' } }] }] as never));
    let img: Area | undefined;
    let box: Area | undefined;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'image') img = a;
      if (a.type === 'block' && Math.abs(a.width - 100) < 0.01 && Math.abs(a.height - 60) < 0.01) box = a;
    });
    expect(box).toBeTruthy();
    expect(img!.x).toBeCloseTo(30, 1);
    expect(img!.y).toBeCloseTo(40, 1);
  });
});

describe('行分割・コンテナ: ハイフン・語間・和欧間アキ・高さの無いコンテナ・表', () => {
  const lineCount = (t: ReturnType<typeof E.engine.layout>) => {
    let n = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') n++;
    });
    return n;
  };
  const glyphEnd = (t: ReturnType<typeof E.engine.layout>) => {
    let end = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'glyph') end = Math.max(end, a.x + a.width);
    });
    return end;
  };

  it('語の中のハイフンの後ろは改行してよい (数字の前は除く)', () => {
    // UAX #14: HY の前では改行しない (LB21)。後ろは、欧文字の前なら改行してよく、数字の前では改行しない (LB25)
    const act = (s: string) => lineBreakActions(Array.from(s, (c) => c.codePointAt(0)!)).slice(1);
    expect(act('a-d')).toEqual(['×', '÷']);
    expect(act('a-5')).toEqual(['×', '×']);
  });

  it('欧文の語が僅かに溢れるときは、語間を詰めて同じ行に収める', () => {
    const text = 'abc def ghi jkl';
    const w = glyphEnd(E.engine.layout(doc([{ type: 'block', children: [text] }])));
    expect(lineCount(E.engine.layout(doc([{ type: 'block', width: w - 0.5, children: [text] }])))).toBe(1);
    expect(lineCount(E.engine.layout(doc([{ type: 'block', width: w - 6, children: [text] }])))).toBe(2);
  });

  it('行末の和欧間アキは捨てる (アキの分だけ溢れる字を次の行へ送らない)', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 100, textAutospace: true, children: ['あ'.repeat(10) + '1986'] }]));
    expect(lineCount(t)).toBe(2);
    const ls: Area[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') ls.push(a);
    });
    let first = 0;
    walk(ls[0], (a) => {
      if (a.type === 'glyph') first++;
    });
    expect(first).toBe(10);
  });

  it('高さの指定の無い block-container は、あふれたらページをまたぐ', () => {
    const t = E.engine.layout(doc([{ type: 'block-container', border: { top: { width: 1, color: '#000000' } }, children: [{ type: 'block', children: [lines(200)] }] }]));
    expect(t.sheets.length).toBeGreaterThan(1);
    // 高さ固定のコンテナは 1 つの箱のまま
    const fixed = E.engine.layout(doc([{ type: 'block-container', height: 50, children: [{ type: 'block', children: [lines(200)] }] }]));
    expect(fixed.sheets.length).toBe(1);
  });

  it('fitContent の表は、列の幅を中身に合わせ、入らなければ行幅に収める', () => {
    const cell = (t: string) => ({ type: 'table-cell' as const, children: [{ type: 'block' as const, children: [t] }] });
    const table = (a: string, b: string) => ({ type: 'table' as const, fitContent: true, columns: [], body: { type: 'table-body' as const, rows: [{ type: 'table-row' as const, cells: [cell(a), cell(b)] }] } });
    const widthOf = (t: ReturnType<typeof E.engine.layout>) => kids(t)[0].width;
    const short = widthOf(E.engine.layout(doc([table('ab', 'abcd') as never])));
    expect(short).toBeGreaterThan(5);
    expect(short).toBeLessThan(60);
    const long = widthOf(E.engine.layout(doc([table('あ'.repeat(80), 'い'.repeat(80)) as never])));
    expect(long).toBeLessThanOrEqual(E.engine.layout(doc([{ type: 'block', children: ['x'] }])).sheets[0].page.regionBody.width + 0.01);
  });

  it("fitContentRule 'ah-html': 最大の長さが均等割り以下の列は最大の長さのまま、残りの列に余りを配る", () => {
    const cell = (t: string) => ({ type: 'table-cell' as const, children: [{ type: 'block' as const, children: [t] }] });
    const short = 'abcdefgh/abcdefgh';
    const table = (rule?: string, cells = [cell('あ'.repeat(80)), cell(short)]) => ({ type: 'table' as const, fitContent: true, ...(rule ? { fitContentRule: rule } : {}), columns: [], body: { type: 'table-body' as const, rows: [{ type: 'table-row' as const, cells }] } });
    const cellWidths = (t: ReturnType<typeof E.engine.layout>) => {
      const out: number[] = [];
      walk(t.sheets[0].page.regionBody as unknown as Area, (a) => {
        if ((a as { type: string }).type === 'table-cell') out.push(a.width);
      });
      return out;
    };
    const avail = E.engine.layout(doc([{ type: 'block', children: ['x'] }])).sheets[0].page.regionBody.width;
    // 短い列の最大の長さ (その列だけの表の幅)。均等割り (使える幅の半分) 以下で、均等割りの半分より長い
    const max = cellWidths(E.engine.layout(doc([table(undefined, [cell(short)]) as never])))[0];
    expect(max).toBeLessThan(avail / 2);
    expect(max).toBeGreaterThan(avail / 4);
    // 既定 (最小と最大の間を同じ比で配る) では短い列も縮むが、'ah-html' では最大の長さのまま
    expect(cellWidths(E.engine.layout(doc([table() as never])))[1]).toBeLessThan(max - 1);
    const ah = cellWidths(E.engine.layout(doc([table('ah-html') as never])));
    expect(ah[1]).toBeCloseTo(max, 1);
    expect(ah[0] + ah[1]).toBeCloseTo(avail, 0);
  });

  it('下側のルビ (rubyTextUnder) は親文字の下に置き、行の下を広げる', () => {
    const h = (r: object) => kids(E.engine.layout(doc([{ type: 'block', children: [{ type: 'ruby', baseText: '東京', rubyText: 'とうきょう', ...r }] }] as never)))[0].height;
    expect(h({ rubyTextUnder: 'Tokyo' })).toBeGreaterThan(h({}));
  });

  it('::first-line (firstLine の inline) の書式は、最初の行の字だけに当てる', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 60, children: [{ type: 'inline', firstLine: true, fontSize: 16, children: ['あいうえおかきくけこさしすせそ'] }] } as never]));
    const ls = kids(t)[0].children as LineArea[];
    const sizes = ls.map((l) => {
      const g: GlyphArea[] = [];
      walk(l, (x) => x.type === 'glyph' && g.push(x as GlyphArea));
      return g[0].fontSize;
    });
    expect(sizes[0]).toBe(16);
    expect(sizes.slice(1).every((v) => v !== 16)).toBe(true);
    // 最初の行は大きい字で組むので、2 行目より字が少ない
    const count = (l: LineArea) => {
      let n = 0;
      walk(l, (x) => x.type === 'glyph' && n++);
      return n;
    };
    expect(count(ls[0])).toBeLessThan(count(ls[1]));
  });

  it('行グリッド (baselineGrid: new): 中の行のベースラインを行グリッドに揃え、上の余白でずれた行は次の格子に送る', () => {
    const t = E.engine.layout(doc([{ type: 'block', baselineGrid: 'new', lineHeight: 1.5, children: [{ type: 'block', children: ['a'] }, { type: 'block', padding: { top: 6 }, children: ['b'] }, { type: 'block', children: ['c'] }] }] as never));
    // 字のベースラインの絶対位置 (祖先の位置・padding と字の baselineY を足す)
    const base: number[] = [];
    const visit = (n: { type: string; y?: number; padding?: { top: number }; border?: { top?: { width: number } }; children?: unknown[] } & Partial<GlyphArea>, y0: number) => {
      const y = y0 + (n.y ?? 0);
      if (n.type === 'glyph') {
        base.push(y + (n.baselineY ?? 0));
        return;
      }
      const inner = n.type === 'block' ? (n.padding?.top ?? 0) + (n.border?.top?.width ?? 0) : 0;
      for (const k of (n.children ?? []) as never[]) visit(k, y + inner);
    };
    visit(kids(t)[0] as never, 0);
    const d1 = base[1] - base[0];
    const d2 = base[2] - base[1];
    expect(d2).toBeGreaterThan(5);
    // 行のベースラインの差は、どれも行グリッドの間隔 (line-height 15pt) の倍数
    for (const d of [d1, d2]) expect(Math.abs(d / 15 - Math.round(d / 15))).toBeLessThan(0.01);
    expect([Math.round(d1 / 15), Math.round(d2 / 15)]).toEqual([2, 1]);
    // 2 行目は padding の分だけ格子から外れるので、格子 2 つ分下がる。3 行目は 1 つ分
    expect(d1).toBeCloseTo(2 * d2, 1);
  });

  it('中身の無い箱の上下の余白: height: 0 は畳み、min-height・height のある箱は畳まない (CSS 2.1 §8.3.1)', () => {
    const ys = (mid: object) => kids(E.engine.layout(doc([{ type: 'block', children: ['a'] }, { type: 'block', margin: { top: 10, bottom: 10 }, ...mid, children: [] }, { type: 'block', children: ['b'] }] as never))).map((n) => +n.y.toFixed(2));
    const a = kids(E.engine.layout(doc([{ type: 'block', children: ['a'] }] as never)))[0].height;
    expect(ys({ height: 0 }).at(-1)).toBeCloseTo(a + 10, 1);
    expect(ys({ minBlockSize: 20 }).at(-1)).toBeCloseTo(a + 40, 1);
    expect(ys({}).at(-1)).toBeCloseTo(a + 10, 1);
  });

  it('CSS の height は、中身があふれても箱の高さ (後ろの内容は箱の下から)', () => {
    const k = kids(E.engine.layout(doc([{ type: 'block', height: 10, children: ['a', '\n', 'b', '\n', 'c'] }, { type: 'block', children: ['d'] }] as never)));
    expect(k[0].height).toBeCloseTo(10, 1);
    expect(k[1].y).toBeCloseTo(10, 1);
  });

  it('新しいブロック整形文脈の箱は、外の float の横に縮めて置き、入らなければ下へ下げる (CSS 2.1 §9.5)', () => {
    const fl = { type: 'float', float: 'start', cssPlacement: true, width: 100, height: 50, children: [{ type: 'block', children: ['f'] }] };
    const t = E.engine.layout(doc([fl, { type: 'block', bfc: true, children: ['abc'] }] as never));
    const body = t.sheets[0].page.regionBody;
    const [, bfc] = kids(t);
    expect(bfc.x).toBeCloseTo(100, 1);
    expect(bfc.width).toBeCloseTo(body.width - 100, 1);
    // 幅の指定が float の横に入らなければ、float の下に置く
    const [, b2] = kids(E.engine.layout(doc([fl, { type: 'block', bfc: true, width: body.width - 50, children: ['abc'] }] as never)));
    expect(b2.y).toBeGreaterThanOrEqual(50 - 0.01);
  });

  it('float の clear・max-width・min-width (CSS)', () => {
    const fl = (o: object) => ({ type: 'float', float: 'start', cssPlacement: true, children: [{ type: 'block', children: ['long long long long long long long text'] }], ...o });
    const k = kids(E.engine.layout(doc([fl({ width: 60, height: 30 }), fl({ clear: 'start', maxWidth: 50 })] as never)));
    expect(k[1].y).toBeGreaterThanOrEqual(30 - 0.01);
    expect(k[1].width).toBeLessThanOrEqual(50 + 0.01);
    const k2 = kids(E.engine.layout(doc([fl({ minWidth: 200, children: [{ type: 'block', children: ['x'] }] })] as never)));
    expect(k2[0].width).toBeCloseTo(200, 1);
  });

  it('word-break: break-all は語の途中でも改行し、keep-all は和文の字の間で改行しない', () => {
    const lines = (wb: 'normal' | 'break-all' | 'keep-all', t: string, w: number) => kids(E.engine.layout(doc([{ type: 'block', width: w, overflowWrap: 'normal', wordBreak: wb, children: [t] } as never])))[0].children.length;
    expect(lines('normal', 'abcdefghij abcdefghij', 40)).toBe(2);
    expect(lines('break-all', 'abcdefghij abcdefghij', 40)).toBeGreaterThan(2);
    expect(lines('normal', 'あいうえおかきくけこ', 40)).toBeGreaterThan(1);
    expect(lines('keep-all', 'あいうえおかきくけこ', 40)).toBe(1);
  });

  it('折り返さない (nowrap) 字があふれるとき、その前の和文の字の間で改行する', () => {
    const t = kids(E.engine.layout(doc([{ type: 'block', width: 60, children: ['あいう', { type: 'inline', noWrap: true, children: ['えおかきく'] }] } as never])));
    // 「あいう」の後ろで改行し、「えおかきく」は 2 行目にまとめる (はみ出す)
    expect(t[0].children.length).toBe(2);
  });

  it('中身の無い行内要素 (CSS) も、字の大きさと行の高さを行に入れる。それだけの行は作らない', () => {
    const h = (kids: unknown[]) => kids0(E.engine.layout(doc([{ type: 'block', children: kids } as never])));
    const kids0 = (t: ReturnType<typeof E.engine.layout>) => kids(t)[0].height;
    const plain = h(['abc']);
    const big = h(['abc', { type: 'inline', fontSize: 40, emptyStrut: true, children: [] }]);
    expect(big).toBeGreaterThan(plain + 20);
    expect(kids(E.engine.layout(doc([{ type: 'block', children: [{ type: 'inline', emptyStrut: true, children: [] }] } as never]))).length === 0 || kids(E.engine.layout(doc([{ type: 'block', children: [{ type: 'inline', emptyStrut: true, children: [] }] } as never])))[0].height === 0).toBe(true);
  });

  it('overflow-wrap: normal (CSS) は、収まらない語を分けずにはみ出す。省略時 (XSL-FO) と anywhere は語の途中で分ける', () => {
    const word = 'Supercalifragilisticexpialidocious';
    const lines = (ow?: 'normal' | 'anywhere') => kids(E.engine.layout(doc([{ type: 'block', width: 40, ...(ow ? { overflowWrap: ow } : {}), children: [`${word} x`] } as never])))[0].children.length;
    expect(lines('normal')).toBe(2);
    expect(lines()).toBeGreaterThan(2);
    expect(lines('anywhere')).toBeGreaterThan(2);
  });

  it('fitContent の表は、見出しの最小の幅 (CAPMIN) より狭くしない (CSS 2.1 §17.5.2.2)', () => {
    const cell = (t: string) => ({ type: 'table-cell' as const, children: [{ type: 'block' as const, children: [t] }] });
    const word = 'Supercalifragilistic';
    const withCap = { type: 'table' as const, fitContent: true, columns: [], captions: [{ side: 'top' as const, block: { type: 'block' as const, overflowWrap: 'normal' as const, children: [`${word} ${word}`] } }], body: { type: 'table-body' as const, rows: [{ type: 'table-row' as const, cells: [cell('x'), cell('y')] }] } };
    const wordCell = { type: 'table' as const, fitContent: true, columns: [], body: { type: 'table-body' as const, rows: [{ type: 'table-row' as const, cells: [cell(word)] }] } };
    const a = kids(E.engine.layout(doc([withCap as never])));
    const b = kids(E.engine.layout(doc([wordCell as never])));
    // 見出しの箱の次が表。表の幅は、見出しの語の幅 (語だけのセルの表と同じ)
    expect(a[1].width).toBeCloseTo(b[0].width, 0);
  });

  it("fitContentRule 'max-ratio' は、入らない列の幅を最大の長さの比で配る (短めの列が広くなる)", () => {
    const cell = (t: string) => ({ type: 'table-cell' as const, children: [{ type: 'block' as const, children: [t] }] });
    const table = (rule?: 'max-ratio') => ({ type: 'table' as const, fitContent: true, ...(rule ? { fitContentRule: rule } : {}), columns: [], body: { type: 'table-body' as const, rows: [{ type: 'table-row' as const, cells: [cell('あ'.repeat(12)), cell('い'.repeat(200))] }] } });
    const cols = (rule?: 'max-ratio') => (kids(E.engine.layout(doc([table(rule) as never])))[0] as unknown as { columnSizes: number[] }).columnSizes;
    const [a1, b1] = cols();
    const [a2, b2] = cols('max-ratio');
    // 合計は同じ (行幅) で、短い列への配分だけが変わる
    expect(a1 + b1).toBeCloseTo(a2 + b2, 1);
    expect(a2).toBeGreaterThan(a1 + 1);
    // 長い列の最大の長さは行幅で頭打ちにして比を取る: 12 字 : 行幅
    const width = a2 + b2;
    expect(a2 / b2).toBeCloseTo(12 * 10 / width, 0);
  });

  it('中身の幅で組む行内の箱は、中のブロックの左右の余白・罫線も含めた幅にする (中の行が折り返さない)', () => {
    const inner = { type: 'inline-container', children: [{ type: 'block', padding: { left: 6, right: 6 }, border: { left: { width: 2, color: '#000000' } }, children: ['abc def'] }] };
    const outer = { type: 'inline-container', children: [{ type: 'block', children: [inner] }] };
    const t = E.engine.layout(doc([{ type: 'block', children: [outer] } as never]));
    let lines = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') lines++;
    });
    // 外の段落の行 1 + 外の箱の行 1 + 中の箱の行 1 (「abc def」が 2 行に割れない)
    expect(lines).toBe(3);
  });

  it('表の行の minHeight は最小の高さ (中身が多ければ広がる)', () => {
    const row = (minHeight: number | undefined, text: string) => ({ type: 'table-row', ...(minHeight ? { minHeight } : {}), cells: [{ type: 'table-cell', children: [{ type: 'block', children: [text] }] }] });
    const h = (r: object) => {
      const t = E.engine.layout(doc([{ type: 'table', columns: [{ type: 'table-column', width: 40 }], body: { type: 'table-body', rows: [r] } } as never]));
      let hh = 0;
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type === 'table-row') hh = a.height;
      });
      return hh;
    };
    const natural = h(row(undefined, 'a'));
    expect(h(row(40, 'a'))).toBeCloseTo(40, 3);
    // 中身の高さの方が大きければ、そちらに合わせる
    expect(h(row(1, 'a'))).toBeCloseTo(natural, 3);
  });

  it('対角罫・逆対角罫は、箱の Area に角どうしを結ぶ線として載る (縦書き vertical-rl は before-start が右上)', () => {
    const blk = (wm?: string) => ({ type: 'block', ...(wm ? { writingMode: wm } : {}), width: 50, height: 30, diagonalBorder: { width: 1, color: '#000000' }, reverseDiagonalBorder: { width: 2, color: '#0000ff' }, children: ['a'] });
    const find = (t: ReturnType<typeof E.engine.layout>) => {
      let d: unknown;
      walk(t.sheets[0].page.regionBody, (a) => {
        if ((a as { diagonals?: unknown }).diagonals) d = (a as { diagonals?: unknown }).diagonals;
      });
      return d as Array<{ kind: string; side: { width: number } }>;
    };
    const h = find(E.engine.layout(doc([blk() as never])));
    expect(h.map((x) => [x.kind, x.side.width])).toEqual([['tlbr', 1], ['trbl', 2]]);
    const v = find(E.engine.layout(doc([blk() as never], 'vertical-rl')));
    expect(v.map((x) => [x.kind, x.side.width])).toEqual([['trbl', 1], ['tlbr', 2]]);
  });

  it("fitContentRule 'max-ratio' で行幅を超えるときは、最小と最大の間を配る方法に戻して行幅に収める", () => {
    const cell = (c: unknown) => ({ type: 'table-cell', children: [{ type: 'block', children: [c] }] });
    // 短い列 4 つ (最大の長さのまま置くと) + 分けられない幅 194pt の列 → 合計が行幅を超える
    const t = E.engine.layout(doc([{ type: 'table', fitContent: true, fitContentRule: 'max-ratio', columns: [], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell('a b'), cell('a b'), cell('a b'), cell('a b'), cell({ type: 'image', src: 'none', width: 194, height: 10 })] }] } } as never]));
    const W = t.sheets[0].page.regionBody.width;
    const cs = (t.sheets[0].page.regionBody.children[0] as unknown as { columnSizes: number[] }).columnSizes;
    expect(cs.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(W + 0.01);
    expect(cs[4]).toBeGreaterThanOrEqual(194 - 0.01);
  });

  it('中身の幅で組む行内の箱は、中のブロックの margin (start-indent など) も含めた幅にする', () => {
    const outer = { type: 'inline-container', children: [{ type: 'block', margin: { left: 10, right: 4 }, children: ['abc def'] }] };
    const t = E.engine.layout(doc([{ type: 'block', children: [outer] } as never]));
    let lines = 0;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'line') lines++;
    });
    // 外の段落の行 1 + 箱の中の行 1 (「abc def」が 2 行に割れない)
    expect(lines).toBe(2);
  });

  it('表のセルの先頭の space-before・末尾の space-after は捨てる', () => {
    const t = (margin: object) =>
      E.engine.layout(doc([{ type: 'table', columns: [], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [{ type: 'table-cell', children: [{ type: 'block', margin, children: ['a'] }] }] }] } } as never]));
    expect(kids(t({ top: 10, bottom: 10 }))[0].height).toBeCloseTo(kids(t({}))[0].height, 3);
  });

  it('90° 回したコンテナ (寸法の指定無し) は、中身をページの幅ごとに区切ってページをまたぐ', () => {
    const rows = Array.from({ length: 80 }, (_, k) => ({ type: 'block' as const, children: [`行${k}`] }));
    const t = E.engine.layout(doc([{ type: 'block-container', rotation: 90, children: rows } as never]));
    expect(t.sheets.length).toBeGreaterThan(1);
  });

  it('collapse モデルの表は、外枠の罫線の半分が表の外 (余白の側) へ出る', () => {
    const t = (collapse: 'collapse' | 'separate') =>
      E.engine.layout(doc([{ type: 'block', children: ['前'] }, { type: 'table', borderCollapse: collapse, margin: { top: 10 }, columns: [], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [{ type: 'table-cell', border: { top: { width: 4, color: '#000000' }, left: { width: 4, color: '#000000' } }, children: [{ type: 'block', children: ['a'] }] }] }] } } as never]));
    const c = kids(t('collapse'))[1];
    const s = kids(t('separate'))[1];
    expect(c.x).toBeCloseTo(s.x - 2, 3);
    expect(c.y).toBeCloseTo(s.y - 2, 3);
  });

  it('lineStackingStrategy="line-height" の行は、字面より小さい line-height でも、その高さにする', () => {
    const h = (extra: object) => kids(E.engine.layout(doc([{ type: 'block', fontSize: 10, lineHeight: 0.4, children: ['あ'], ...extra } as never])))[0].height;
    expect(h({})).toBeCloseTo(10, 0);
    expect(h({ lineStackingStrategy: 'line-height' })).toBeCloseTo(4, 3);
  });

  it('fontLineMetrics: 上下の比率の違う書体が混ざる行は、字ごとに line-height を割り振って広がる', async () => {
    const { FontManager } = await import('../src/fontManager');
    const fm = E.fonts as InstanceType<typeof FontManager>;
    const f = fm.get(FAMILY, 400);
    const saved = f.ascentMinusDescent;
    const h = (on: boolean) => kids(E.engine.layout(doc([{ type: 'block', fontSize: 10, lineHeight: 1.2, fontLineMetrics: on, children: ['あa'] } as never])))[0].height;
    // 書体が 1 つなら変わらない
    expect(h(true)).toBeCloseTo(h(false), 3);
    f.ascentMinusDescent = saved;
  });

  it('fontLineMetrics: 横書きの字だけの行は、書体が 1 つでも書体の上下の高さで基準線を決める (行の高さは変わらない)', async () => {
    const { FontManager } = await import('../src/fontManager');
    const fm = E.fonts as InstanceType<typeof FontManager>;
    const f = fm.get(FAMILY, 400);
    const saved = f.ascentMinusDescent;
    f.ascentMinusDescent = 0.6;
    const base = (on: boolean, extra: unknown[] = []) => {
      const b = kids(E.engine.layout(doc([{ type: 'block', fontSize: 10, lineHeight: 1.2, fontLineMetrics: on, children: ['あ', ...extra] } as never])))[0];
      let y: number | undefined;
      const rec = (a: any, oy: number) => {
        if (y !== undefined) return;
        if (a.type === 'glyph') y = oy + a.y + a.baselineY;
        for (const c of a.children ?? []) rec(c, oy + a.y);
      };
      for (const c of (b as any).children) rec(c, 0);
      return { y: y!, h: b.height };
    };
    try {
      // 字の上 = (行送り 12 + (ascent − descent) 6) / 2 = 9
      expect(base(true).y).toBeCloseTo(9, 3);
      expect(base(true).h).toBeCloseTo(base(false).h, 3);
      // 切り替えないとき: em の箱の基準線 + 行送りの半分のアキ
      expect(base(false).y).toBeCloseTo(f.baselineRatio * 10 + 1, 3);
      // 行内の箱 (画像など) のある行は、これまでどおり
      const withBox = [{ type: 'image', src: 'none', width: 5, height: 5 }];
      expect(base(true, withBox).y).toBeCloseTo(base(false, withBox).y, 3);
    } finally {
      f.ascentMinusDescent = saved;
    }
  });

  it('行分けの使い回し: 同じ文書の木でも、幅・分綴の関数・書体の状態が違えば組み直す', async () => {
    const { LayoutEngine } = await import('../src/layoutEngine');
    const hy = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, hyphenate: (w) => (w === 'formatting' ? [2, 5] : undefined) });
    const text = 'aaaa formatting';
    const tree = (width: number) => doc([{ type: 'block', width, hyphenate: true, children: [text] } as never]);
    const lineTexts = (t: ReturnType<typeof E.engine.layout>) => {
      const out: string[] = [];
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type !== 'line') return;
        let s = '';
        walk(a, (g) => {
          if (g.type === 'glyph') s += (g as GlyphArea).text;
        });
        out.push(s);
      });
      return out;
    };
    const one = lineTexts(E.engine.layout(tree(1000)));
    expect(one).toHaveLength(1);
    const full = (() => {
      let end = 0;
      walk(E.engine.layout(tree(1000)).sheets[0].page.regionBody, (a) => {
        if (a.type === 'glyph') end = Math.max(end, a.x + a.width);
      });
      return end;
    })();
    // 同じ木を、分綴の無いエンジンと有るエンジンで組む (同じ測り方)
    const d = tree(full - 8);
    expect(lineTexts(E.engine.layout(d))).toEqual(['aaaa', 'formatting']);
    expect(lineTexts(hy.layout(d))[0]).toMatch(/-$/);
    expect(lineTexts(E.engine.layout(d))).toEqual(['aaaa', 'formatting']);
    // 書体の状態が変わったら、覚えたものは使わない
    const fm = E.fonts as unknown as { generation: number };
    const g0 = fm.generation;
    fm.generation++;
    expect(E.measurer.version()).not.toBe(`${E.measurer.version().split(':')[0]}:${g0}`);
    expect(lineTexts(E.engine.layout(d))).toEqual(['aaaa', 'formatting']);
  });

  it('段の高さ揃えで中身を何度も組んでも、段落の字の計測は 1 回分で済む (行分けの使い回し)', async () => {
    const { vi } = await import('vitest');
    const paras = Array.from({ length: 6 }, (_, k) => ({ type: 'block', children: [`段落${k}の本文。`.repeat(8)] }));
    const spy = vi.spyOn(E.measurer, 'glyph');
    try {
      E.engine.layout(doc([{ type: 'block-container', columns: { count: 2, gap: 10 }, children: paras }] as never));
      const chars = paras.reduce((a, p) => a + [...(p.children[0] as string)].length, 0);
      // 二分探索で 10 回以上組むが、字の計測は最初の 1 回分 (と少し) だけ
      expect(spy.mock.calls.length).toBeLessThan(chars * 2);
    } finally {
      spy.mockRestore();
    }
  });

  it('分綴: hyphenate の語は、分綴の位置でハイフンを付けて行を分ける', async () => {
    const { LayoutEngine } = await import('../src/layoutEngine');
    const eng = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, hyphenate: (w) => (w === 'formatting' ? [2, 5] : undefined) });
    const text = 'aaaa formatting';
    const full = (() => {
      let end = 0;
      walk(eng.layout(doc([{ type: 'block', children: [text] }])).sheets[0].page.regionBody, (a) => {
        if (a.type === 'glyph') end = Math.max(end, a.x + a.width);
      });
      return end;
    })();
    const lines = (hy: boolean) => {
      const t = eng.layout(doc([{ type: 'block', width: full - 8, hyphenate: hy, children: [text] } as never]));
      const out: string[] = [];
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type === 'line') {
          let s = '';
          walk(a, (g) => {
            if (g.type === 'glyph') s += (g as GlyphArea).text;
          });
          out.push(s);
        }
      });
      return out;
    };
    expect(lines(false)).toEqual(['aaaa', 'formatting']);
    expect(lines(true)).toEqual(['aaaa format-', 'ting']);
  });

  it('太字の書体が無い書体で太字を求めたら、疑似太字 (fakeBold) で描く', () => {
    const t = E.engine.layout(doc([{ type: 'block', fontWeight: 700, children: ['あ'] } as never]));
    let g: GlyphArea | undefined;
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type === 'glyph') g = a as GlyphArea;
    });
    expect(g?.fakeBold).toBe(true);
  });
});

describe('line-height-shift-adjustment', () => {
  it('disregard-shifts: 上付きの字で行を広げない (既定の consider-shifts は広げる)', () => {
    const para = (adj?: 'disregard-shifts') => ({
      type: 'block' as const,
      lineHeightPt: 12,
      ...(adj ? { lineHeightShiftAdjustment: adj } : {}),
      children: ['本文', { type: 'inline' as const, baselineShift: 'super' as const, fontSize: 9, children: ['注'] }, '\n次の行'],
    });
    const pitch = (adj?: 'disregard-shifts') => {
      const t = E.engine.layout(doc([para(adj)]));
      const ys: number[] = [];
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type === 'line') ys.push(a.y);
      });
      return ys[1] - ys[0];
    };
    expect(pitch()).toBeGreaterThan(12);
    expect(pitch('disregard-shifts')).toBeCloseTo(12);
  });
});

describe('retrieve-marker: first-except・start', () => {
  it('first-except は始まったページで空、start はページの先頭の値', () => {
    const mk = (name: string) => ({ type: 'marker' as const, className: 'h', children: [name] });
    const head = (position: 'first-except' | 'start') => ({
      type: 'block-container' as const,
      absolutePosition: true,
      top: 0,
      left: 0,
      width: 100,
      height: 20,
      children: [{ type: 'block' as const, children: [`${position}:`, { type: 'retrieve-marker' as const, className: 'h', position }] }],
    });
    const t = E.engine.layout(
      doc([mk('A'), { type: 'block', children: ['一'] }, { type: 'block', breakBefore: 'page', children: ['二'] }, { type: 'block', breakBefore: 'page', children: ['三'] }, mk('C'), { type: 'block', children: ['四'] }], 'horizontal-tb', {
        staticContent: [head('first-except'), head('start')],
      }),
    );
    const heads = t.sheets.map((s) => {
      const out: string[] = [];
      for (const a of s.page.absoluteAreas) {
        const txt: string[] = [];
        walk(a, (n) => {
          if (n.type === 'glyph') txt.push((n as GlyphArea).text);
        });
        out.push(txt.join(''));
      }
      return out.join(' ');
    });
    expect(heads).toEqual(['first-except: start:A', 'first-except:A start:A', 'first-except: start:A']);
  });
});

describe('fontFeatures (OpenType の機能)', () => {
  it('機能を当てた送りで組む (palt: 約物を詰める)', () => {
    const width = (fontFeatures?: string[]) => {
      const t = E.engine.layout(doc([{ type: 'block', fontSize: 10, ...(fontFeatures ? { fontFeatures } : {}), children: ['（'] }]));
      let w = 0;
      walk(t.sheets[0].page.regionBody, (a) => {
        if (a.type === 'glyph') {
          w = (a as GlyphArea).advance;
          if (fontFeatures) expect((a as GlyphArea).features).toEqual(fontFeatures);
        }
      });
      return w;
    };
    expect(width()).toBeCloseTo(10, 1);
    expect(width(['palt'])).toBeLessThan(7);
  });

  it('機能による字の位置のずれは、書体・字・機能の組ごとに 1 度だけ求める (同じ字を増やしても fontkit の layout は増えない)', async () => {
    const { vi } = await import('vitest');
    const font = E.fonts.get(undefined, 400).fk;
    const count = (n: number) => {
      const spy = vi.spyOn(font, 'layout');
      E.engine.layout(doc([{ type: 'block', fontSize: 10, fontFeatures: ['palt'], children: ['（あ）'.repeat(n)] }]));
      const c = spy.mock.calls.length;
      spy.mockRestore();
      return c;
    };
    count(1);
    // 2 回目以降は、字が増えても呼び出しは増えない (覚えた結果を使う)
    expect(count(30)).toBe(count(1));
  });
});

describe('float: after・center・alternate', () => {
  const box = (text: string, h = 20) => ({ type: 'block' as const, height: h, children: [text] });
  const find = (t: ReturnType<typeof E.engine.layout>, ch: string, sheet = 0) => {
    let hit: { x: number; y: number } | undefined;
    const walk2 = (a: Area, x: number, y: number) => {
      const ax = x + a.x;
      const ay = y + a.y;
      if (!hit && a.type === 'glyph' && (a as GlyphArea).text === ch) hit = { x: ax, y: ay };
      const k = a as unknown as { children?: Area[] };
      for (const c of k.children ?? []) walk2(c, ax, ay);
    };
    // 本文領域の中の座標 (本文領域そのものの位置は足さない)
    for (const c of (t.sheets[sheet].page.regionBody as unknown as { children: Area[] }).children) walk2(c, 0, 0);
    return hit!;
  };

  it('after: 段の下端に、書いた順に積む。本文はその上で止まり、次のページへ続く', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', children: ['本'] },
        { type: 'float', float: 'after', children: [box('甲')] },
        { type: 'float', float: 'after', children: [box('乙')] },
        { type: 'block', children: [lines(30, '文')] },
      ]),
    );
    const body = pt(80);
    const a = find(t, '甲');
    const b = find(t, '乙');
    expect(b.y).toBeGreaterThan(a.y);
    expect(b.y).toBeLessThan(body);
    expect(b.y + 20).toBeGreaterThan(body - 12);
    expect(t.sheets.length).toBeGreaterThan(1);
  });

  it('after: 高さを釣り合わせる段組のコンテナでは、本文の段を釣り合わせてから、基準の行のある段の内容の後ろに積む', () => {
    // 本文 10 行 (5 行ずつ) + 2 段目の基準の行の後ろの float。float を含めて釣り合わせると 2 段目の本文が 4 行に減る
    const t = E.engine.layout(
      doc([{ type: 'block-container', columns: { count: 2, gap: 10 }, children: [{ type: 'block', textAlign: 'start', children: [lines(8, 'あ')] }, { type: 'float', float: 'after', children: [box('甲')] }, { type: 'block', textAlign: 'start', children: [lines(2, 'い')] }] }]),
    );
    const a1 = find(t, '1');
    const a6 = find(t, '6');
    const i1 = find(t, 'い');
    const f = find(t, '甲');
    // 「あ6」は 2 段目の先頭 (5 行ずつ)、float は 2 段目の本文の後ろ
    expect(a6.x).toBeGreaterThan(a1.x + 50);
    expect(a6.y).toBeCloseTo(a1.y, 0);
    expect(f.x).toBeGreaterThan(a1.x + 50);
    expect(f.y).toBeGreaterThan(i1.y);
  });

  it('center: 段の中央に置き、本文はその下から続く', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: [{ type: 'float', float: 'center', width: 40, children: [box('中')] }, '後の文'] }]));
    const c = find(t, '中');
    const after = find(t, '後');
    expect(c.x).toBeGreaterThan(pt(80) / 2 - 30);
    expect(after.y).toBeGreaterThan(c.y + 15);
  });

  it('alternate: 2 段組のコンテナで、1 段目は end、2 段目は start に寄せる', () => {
    const fl = (ch: string) => ({ type: 'float' as const, float: 'alternate' as const, width: 20, children: [box(ch, 10)] });
    const t = E.engine.layout(
      doc([{ type: 'block-container', height: 60, columns: { count: 2, gap: 10 }, children: [{ type: 'block', children: [fl('一'), lines(2, 'あ')] }, { type: 'block', breakBefore: 'column', children: [fl('二'), lines(2, 'い')] }] }]),
    );
    const col = (pt(80) - 10) / 2;
    const one = find(t, '一');
    const two = find(t, '二');
    expect(one.x).toBeGreaterThan(col - 25);
    expect(one.x).toBeLessThan(col);
    expect(two.x).toBeGreaterThan(col + 10 - 1);
    expect(two.x).toBeLessThan(col + 10 + 5);
  });
});

describe('wordSpaceShrink', () => {
  it('false なら、欧文の語間を本来の幅より詰めて語を行に収めない', () => {
    const lineCount = (wordSpaceShrink?: boolean) => {
      // 行が僅かに溢れる長さの欧文 (語間を詰めれば 1 行に入る)
      const words = 'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss tt uu vv ww xx yy zz';
      let best = 0;
      for (let n = 10; n <= words.length; n++) {
        const t = E.engine.layout(doc([{ type: 'block', fontSize: 10, textAlign: 'justify', ...(wordSpaceShrink === undefined ? {} : { wordSpaceShrink }), children: [words.slice(0, n)] }]));
        let lines = 0;
        walk(t.sheets[0].page.regionBody, (a) => {
          if (a.type === 'line') lines++;
        });
        if (lines === 1) best = n;
      }
      return best;
    };
    // 詰めてよければ、1 行に入る文字列が長い
    expect(lineCount()).toBeGreaterThan(lineCount(false));
  });
});

describe('ページをまたぐ段組のコンテナ', () => {
  /** 用紙ごとの行の文字列 */
  const pageLines = (t: ReturnType<typeof E.engine.layout>) =>
    t.sheets.map((s) => {
      const out: string[] = [];
      walk(s.page.regionBody, (a) => {
        if (a.type === 'line') {
          let txt = '';
          walk(a, (g) => {
            if (g.type === 'glyph') txt += (g as GlyphArea).text;
          });
          out.push(txt);
        }
      });
      return out;
    });

  it('収まらなければ、見出しのすぐ後ろから段を埋めてページをまたぐ。中身は欠けない', () => {
    const items = Array.from({ length: 150 }, (_, i) => ({ type: 'block', children: [`項目${i + 1}`] }));
    const t = E.engine.layout(doc([{ type: 'block', fontSize: 30, keepWithNext: true, children: ['索引'] }, { type: 'block-container', columns: { count: 2, gap: 10 }, children: items }] as never));
    const pages = pageLines(t);
    expect(t.sheets.length).toBeGreaterThan(1);
    // 1 ページ目に見出しと段の中身
    expect(pages[0][0]).toBe('索引');
    expect(pages[0].length).toBeGreaterThan(10);
    // すべての項目が、どこかのページに 1 度ずつ
    const all = pages.flat().filter((l) => l.startsWith('項目'));
    expect(all).toHaveLength(150);
    expect(new Set(all).size).toBe(150);
  });

  it('釣り合わせた 1 行がページに収まるなら、従来どおり 1 つの箱', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ type: 'block', children: [`項目${i + 1}`] }));
    const t = E.engine.layout(doc([{ type: 'block-container', columns: { count: 2, gap: 10 }, children: items }] as never));
    expect(t.sheets).toHaveLength(1);
    expect(pageLines(t)[0]).toHaveLength(10);
  });
});

describe('書字方向の違うブロックの余白', () => {
  it('横書きの中の縦書きのブロックの上下の余白は、前後のブロックの余白と相殺する (箱の中には含めない)', () => {
    const t = E.engine.layout(
      doc([
        { type: 'block', margin: { bottom: 10 }, children: ['前'] },
        { type: 'block', writingMode: 'vertical-rl', height: 50, margin: { top: 10, bottom: 10 }, children: ['縦'] },
        { type: 'block', margin: { top: 10 }, children: ['後'] },
      ] as never),
    );
    const blocks = kids(t);
    const bottom = (b: BlockArea) => b.y + b.height;
    // 前の下端から縦書きの箱まで 10 (20 ではない)、縦書きの箱は高さ 50、その下端から後まで 10
    expect(blocks[1].y - bottom(blocks[0])).toBeCloseTo(10, 1);
    expect(blocks[1].height).toBeCloseTo(50, 1);
    expect(blocks[2].y - bottom(blocks[1])).toBeCloseTo(10, 1);
  });
});

describe('LNode (newNode)', () => {
  it('字のノードは、変更できない共有の空の余白・罫線・子を使う (ほかの種類は毎回新しく作る)', async () => {
    const { newNode } = await import('../src/lnode');
    const a = newNode('glyph', 'horizontal-tb');
    const b = newNode('glyph', 'horizontal-tb');
    expect(a.margin).toBe(b.margin);
    expect(a.children).toBe(b.children);
    expect(Object.isFrozen(a.margin) && Object.isFrozen(a.padding) && Object.isFrozen(a.border) && Object.isFrozen(a.children)).toBe(true);
    const c = newNode('block', 'horizontal-tb');
    const d = newNode('block', 'horizontal-tb');
    expect(c.margin).not.toBe(d.margin);
    expect(Object.isFrozen(c.children)).toBe(false);
  });
});

describe('縦書きの行の高さ', () => {
  it('書体の混ざる縦書きの行 (和文と回転した欧文) でも、字は行の中央にそろう (横書きの ascent・descent を使わない)', async () => {
    const { lineMetrics } = await import('../src/inlineLayout');
    const st = { fontSize: 10, lineHeight: 1.2, fontLineMetrics: true } as never;
    const fontA = { ascentMinusDescent: 0.8, baselineRatio: 0.88 };
    const fontB = { ascentMinusDescent: 0.7, baselineRatio: 0.88 };
    const glyph = (ch: string, font: object) => ({ kind: 'glyph', first: ch, last: ch, advance: 10, isSpace: false, runId: 0, st, g: { font, advance: 10 } });
    const pl = { raw: { items: [glyph('あ', fontA), glyph('X', fontB)], last: true, indent: 0 }, offsets: [0, 10], widths: [10, 10], contentLength: 20 } as never;
    const v = lineMetrics(pl, 'vertical-rl', st);
    expect(v.above).toBeCloseTo(v.below, 5);
    // 横書きでは、書体の上下の高さで割り振る (従来どおり)
    const h = lineMetrics(pl, 'horizontal-tb', st);
    expect(h.above).toBeGreaterThan(h.below);
  });
});

describe('点線の罫線', () => {
  it('図形を塗れる描画先では、点を丸く描く (角の丸い四角 = 円で、点ごとにベジエ曲線)', async () => {
    const { paintArea } = await import('../src/paint');
    const paths: unknown[][] = [];
    let rects = 0;
    const p = {
      fillRect: () => rects++,
      drawGlyph: () => {},
      drawImage: () => {},
      transform: (_m: unknown, d: () => void) => d(),
      strokeLine: () => {},
      clipRect: () => {},
      restore: () => {},
      fillPath: (path: unknown[]) => paths.push(path),
      strokePath: () => {},
    };
    const area = { type: 'block', x: 0, y: 0, width: 100, height: 20, margin: {}, padding: { top: 0, right: 0, bottom: 0, left: 0 }, border: { top: { width: 1, color: '#000000', style: 'dotted' } }, children: [] };
    paintArea(area as never, 0, 0, p as never);
    expect(rects).toBe(0);
    expect(paths.length).toBe(1);
    expect((paths[0] as Array<{ op: string }>).filter((s) => s.op === 'C').length).toBeGreaterThan(20);
  });
});

describe('破線・点線の模様と、立体の罫線の角', () => {
  const painter = () => {
    const rects: number[][] = [];
    const paths: Array<Array<{ op: string; x?: number; y?: number }>> = [];
    const p = {
      fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
      drawGlyph: () => {},
      drawImage: () => {},
      transform: (_m: unknown, d: () => void) => d(),
      strokeLine: () => {},
      clipRect: () => {},
      restore: () => {},
      fillPath: (path: Array<{ op: string; x?: number; y?: number }>) => paths.push(path),
      strokePath: () => {},
    };
    return { p, rects, paths };
  };
  const box = (border: object, width = 100, height = 20) => ({ type: 'block', x: 0, y: 0, width, height, margin: {}, padding: { top: 0, right: 0, bottom: 0, left: 0 }, border, children: [] });

  it('下の破線は右端から、半分の長さ (2w) の線で始め、4w の線と 2w の空きを繰り返す', async () => {
    const { paintArea } = await import('../src/paint');
    const { p, rects } = painter();
    paintArea(box({ bottom: { width: 1, color: '#000000', style: 'dashed' } }) as never, 0, 0, p as never);
    const xs = rects.map(([x, , w]) => [x, x + w]).sort((a, b) => b[0] - a[0]);
    expect(xs[0]).toEqual([98, 100]);
    expect(xs[1]).toEqual([92, 96]);
    // 左端は模様の余りのまま (100 = 2 + 6×16 + 2 → 左端の 2 は空き)
    expect(Math.min(...xs.map((v) => v[0]))).toBe(2);
  });

  it('4 辺とも同じ破線なら、時計回りに模様が続く (右の辺は、上の辺の長さ − w だけ進んだ位相で始まる)', async () => {
    const { paintArea } = await import('../src/paint');
    const { p, rects } = painter();
    const d = { width: 1, color: '#000000', style: 'dashed' };
    paintArea(box({ top: d, right: d, bottom: d, left: d }, 100, 50) as never, 0, 0, p as never);
    // 右の辺 (x = 99): 位相 2 + 99 = 101 → 101 mod 6 = 5 (空きの途中) → 最初の線は 1 進んだ y=1 から 4
    const right = rects.filter(([x, , w]) => x === 99 && w === 1).map(([, y, , h]) => [y, y + h]).sort((a, b) => a[0] - b[0]);
    expect(right[0]).toEqual([1, 5]);
  });

  it('点線: 線の中心を通る道に、時計回りに 2.5w ごとの丸い点 (下の辺は右から)', async () => {
    const { paintArea } = await import('../src/paint');
    const { p, paths } = painter();
    paintArea(box({ bottom: { width: 2, color: '#000000', style: 'dotted' } }) as never, 0, 0, p as never);
    const firstX = Math.max(...paths[0].filter((s) => s.op === 'M').map((s) => s.x!));
    // 右端の点の中心は 100 − 1 = 99 (点の左端は 98)
    expect(firstX).toBeCloseTo(98 + 1, 0);
  });

  it('ridge の角は、外の角と内の角を結ぶ線で斜めに突き合わせる (台形)', async () => {
    const { paintArea } = await import('../src/paint');
    const { p, rects, paths } = painter();
    const r = { width: 4, color: '#008000', style: 'ridge' };
    paintArea(box({ top: r, right: r, bottom: r, left: r }) as never, 0, 0, p as never);
    // 上の辺の外側の半分 (台形 (0,0)-(100,0)-(98,2)-(2,2)): 真ん中は矩形、角は三角形
    expect(rects[0]).toEqual([2, 0, 96, 2]);
    expect(paths[0].filter((s) => s.op !== 'Z').map((s) => [s.x, s.y])).toEqual([[0, 0], [2, 0], [2, 2]]);
    expect(paths[1].filter((s) => s.op !== 'Z').map((s) => [s.x, s.y])).toEqual([[100, 0], [98, 0], [98, 2]]);
  });
});

describe('高さの下限 (minBlockSize)', () => {
  it('中身が少なくても下限の高さを取り、多ければ中身の高さ', () => {
    const h = (children: unknown[]) => {
      const t = E.engine.layout(doc([{ type: 'block-container', minBlockSize: 50, children }] as never));
      return (t.sheets[0].page.regionBody.children[0] as { height: number }).height;
    };
    expect(h([{ type: 'block', children: ['あ'] }])).toBeCloseTo(50);
    expect(h(Array.from({ length: 10 }, () => ({ type: 'block', children: ['あ'] })))).toBeGreaterThan(50);
  });
});

describe('回り込みの経路の widows', () => {
  it('回り込みのある段落がページをまたぐとき、次のページの行を 1 行だけにしない', () => {
    const fl = { type: 'float' as const, float: 'start' as const, width: 80, height: 150, children: ['図'] };
    let checked = 0;
    for (let k = 0; k < 16; k++) {
      const t = E.engine.layout(
        doc([
          { type: 'block', height: 70 + k / 2, children: [] },
          { type: 'block', children: [fl, 'あ'] },
          { type: 'block', children: ['あいうえお'.repeat(25)] },
        ] as never),
      );
      if (t.sheets.length < 2) continue;
      const cont = (t.sheets[1].page.regionBody.children as BlockArea[]).find((c) => c.isContinuation);
      const n = cont ? cont.children.filter((c) => c.type === 'line').length : 0;
      if (n > 0) {
        checked++;
        expect(n).toBeGreaterThanOrEqual(2);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('代わりの書体の字と行の高さ (CSS Inline 3 §5.3)', () => {
  it('primaryFontMetrics: 行の高さは最初に使える書体で決め、代わりの書体の字は行の基線にそろえて置く', async () => {
    const E2 = await makeEngine();
    // 最初に使える書体 (STIX Two Math。かなが無い) と、代わりの書体 (Noto Serif JP)
    await E2.fonts.registerBuffer('STIX', 400, await mathFontBuffer(), false);
    const run = (flag: boolean) => {
      const t = E2.engine.layout(
        doc([{ type: 'block', fontFamily: 'STIX', fontSize: 10, lineHeightPt: 16, ...(flag ? { primaryFontMetrics: true } : {}), children: ['a1\na2 あ\na3'] } as never]),
      );
      const b = (t.sheets[0].page.regionBody.children as BlockArea[])[0];
      /** 各行の字の基線 (行の y + 字の y + 字の baselineY) */
      return (b.children as LineArea[]).map((l) => {
        const out: Record<string, number> = {};
        const rec = (n: any, oy: number) => {
          const y = oy + n.y;
          if (n.type === 'glyph') out[n.text] = Math.round((y + (n.baselineY ?? 0)) * 100) / 100;
          for (const c of [...(n.children ?? []), ...(n.glyphs ?? [])]) rec(c, y);
        };
        rec(l, b.y);
        return out;
      });
    };
    const [l1, l2, l3] = run(true);
    // 行送りはいつも 16pt (代わりの書体の字の行も高くならない)
    expect(l2['2'] - l1['1']).toBeCloseTo(16, 1);
    expect(l3['3'] - l2['2']).toBeCloseTo(16, 1);
    // 代わりの書体の字も、行の基線に置く
    expect(l2['あ']).toBeCloseTo(l2['2'], 1);
  });
});

describe('HTML のリストの本文の欄・行の中の画像の揃え', () => {
  it('keepTrailingSpace: セルの最後の子の下の余白を、セルの高さに含める', async () => {
    const E2 = await makeEngine();
    const cellH = (keep: boolean) => {
      const t = E2.engine.layout(
        doc([{ type: 'table', columns: [{ type: 'table-column', width: 100 }], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [{ type: 'table-cell', ...(keep ? { keepTrailingSpace: true } : {}), children: [{ type: 'block', margin: { bottom: 20 }, children: ['あ'] }] }] }] } } as never]),
      );
      const tb = (t.sheets[0].page.regionBody.children as BlockArea[])[0];
      return tb.height;
    };
    expect(cellH(true) - cellH(false)).toBeCloseTo(20, 1);
  });

  it('画像の alignmentBaseline: after-edge は下端を字面の下端 (基線から書体の下の比だけ下) に置く', async () => {
    const E2 = await makeEngine();
    const imgY = (ab?: string) => {
      const t = E2.engine.layout(doc([{ type: 'block', fontSize: 10, lineHeightPt: 20, children: ['あ', { type: 'image', src: 'x.png', width: 10, height: 10, ...(ab ? { alignmentBaseline: ab } : {}) }] } as never]));
      let y = 0;
      let base = 0;
      const rec = (n: any, oy: number) => {
        const yy = oy + n.y;
        if (n.type === 'image') y = yy + n.height;
        if (n.type === 'glyph') base = yy + (n.baselineY ?? 0);
        for (const c of [...(n.children ?? []), ...(n.glyphs ?? [])]) rec(c, yy);
      };
      for (const c of t.sheets[0].page.regionBody.children) rec(c, 0);
      return y - base; // 字の基線から画像の下端まで
    };
    const br = E2.measurer.glyph(' ', { fontFamily: FAMILY, fontWeight: 400, fontSize: 10 } as never, 'horizontal-tb').font.baselineRatio;
    expect(imgY()).toBeCloseTo(0, 1);
    expect(imgY('after-edge')).toBeCloseTo((1 - br) * 10, 1);
  });
});

describe('行グリッド (アンテナハウスの baseline-grid) のページの終わり', () => {
  it('最後の行の後ろの半行間は、ページに入るかの判定に数えない', async () => {
    const E2 = await makeEngine();
    // 本文領域 226.77pt のうち、15.77pt の箱の後ろに 211pt 残る。行グリッドの最初の行は上の半行間を空けないので 15pt、
    // 続く行は 20pt: 11 行目の下端は 215pt、その下の半行間 (5pt) を数えなければ 210pt で入る
    const firstPageLines = (grid: boolean) => {
      const t = E2.engine.layout(
        doc([
          { type: 'block', height: 15.77, children: [] },
          { type: 'block', fontSize: 10, lineHeightPt: 20, ...(grid ? { baselineGrid: 'new' } : {}), children: [lines(14)] },
        ] as never),
      );
      let n = 0;
      walk(t.sheets[0].page.regionBody, (a) => a.type === 'line' && n++);
      return n;
    };
    expect(firstPageLines(false)).toBe(10);
    expect(firstPageLines(true)).toBe(11);
  });
});

describe('leader の点の上下の位置', () => {
  it('点は、字の大きさが違っても本文と同じ基線に置く (書体の基線の比で)', async () => {
    const E2 = await makeEngine();
    // 基線の比が 0.88 でない書体 (STIX Two Math)
    await E2.fonts.registerBuffer('STIX', 400, await mathFontBuffer(), false);
    const t = E2.engine.layout(
      doc([{ type: 'block', fontFamily: 'STIX', fontSize: 10, width: 200, children: ['ab', { type: 'inline', fontSize: 8, children: [{ type: 'leader', cssLeader: true }] }, 'cd'] } as never]),
    );
    const base: Record<string, number[]> = {};
    const rec = (n: any, oy: number) => {
      const y = oy + n.y;
      if (n.type === 'glyph') (base[n.text] ??= []).push(Math.round((y + (n.baselineY ?? 0)) * 100) / 100);
      for (const c of [...(n.children ?? []), ...(n.glyphs ?? [])]) rec(c, y);
    };
    for (const c of t.sheets[0].page.regionBody.children) rec(c, 0);
    expect(base['.']?.length).toBeGreaterThan(3);
    for (const y of base['.']) expect(y).toBeCloseTo(base['a'][0], 1);
  });
});

describe('行に収まらない中身の揃え (CSS Text 3 §6.1)', () => {
  const firstX = (extra: object) => {
    const t = E.engine.layout(doc([{ type: 'block', width: 30, textAlign: 'center', noWrap: true, ...extra, children: ['WWWWWWWWWW'] } as never]));
    const ls: Area[] = [];
    walk(t.sheets[0].page.regionBody as unknown as Area, (a) => {
      if (a.type === 'line') ls.push(a);
    });
    // 行の中身 (inline の箱) の、行の始めからの位置
    return { n: ls.length, x: ((ls[0] as unknown as { children: Array<{ x: number }> }).children[0]?.x ?? 0) };
  };
  it('text-align: center でも、行の始めにそろえて終わり側へはみ出す', () => {
    const def = firstX({});
    expect(def.n).toBe(1);
    expect(def.x).toBeCloseTo(0, 3);
  });
});

describe('支柱 (CSS 2.1 §10.8.1)', () => {
  it('行の高さは、ブロックの書体と line-height の支柱を下回らない (互換モードの noStrut では入れない)', () => {
    const lineH = (noStrut: boolean) => {
      const t = E.engine.layout(doc([{ type: 'block', fontSize: 20, lineHeight: 1.5, primaryFontMetrics: true, ...(noStrut ? { noStrut: true } : {}), children: [{ type: 'inline', fontSize: 8, lineHeight: 1, children: ['abc'] }] } as never]));
      const ls: Area[] = [];
      walk(t.sheets[0].page.regionBody as unknown as Area, (a) => {
        if (a.type === 'line') ls.push(a);
      });
      return ls[0].height;
    };
    // 支柱: 20pt × 1.5 = 30pt。支柱が無ければ、行の中の 8pt の字の行の高さ (8pt) だけ
    expect(lineH(false)).toBeCloseTo(30, 1);
    expect(lineH(true)).toBeLessThan(12);
  });
  it('強制改行だけの空の行の高さは、支柱だけ (字のある行と同じ line-height)', () => {
    const t = E.engine.layout(doc([{ type: 'block', fontSize: 10, lineHeight: 1.5, primaryFontMetrics: true, children: ['a', '\n', '\n', 'b'] } as never]));
    const ls: Area[] = [];
    walk(t.sheets[0].page.regionBody as unknown as Area, (a) => {
      if (a.type === 'line') ls.push(a);
    });
    expect(ls.map((l) => Math.round(l.height * 100) / 100)).toEqual([15, 15, 15]);
  });
  it('行内の箱は字ごとの半行間を持つ: 同じ line-height の小さい字の箱は下へはみ出し、行を広げる (CSS 2.1 §10.8.1)', () => {
    const h = (kids: unknown[]) => {
      const t = E.engine.layout(doc([{ type: 'block', fontSize: 10, lineHeightPt: 13, primaryFontMetrics: true, children: kids } as never]));
      const ls: Area[] = [];
      walk(t.sheets[0].page.regionBody as unknown as Area, (a) => {
        if (a.type === 'line') ls.push(a);
      });
      return ls[0].height;
    };
    expect(h(['a'])).toBeCloseTo(13, 3);
    // 4pt の字の箱は、下へ (13 − 4) / 2 の半行間を持つので、10pt の字の箱より下へ出る
    expect(h(['a', { type: 'inline', fontSize: 4, children: ['b'] }])).toBeGreaterThan(14);
  });
  it('縦書きの行にも支柱を入れる (line-height の半分ずつを中央の基線の左右に)', () => {
    const lineW = (noStrut: boolean) => {
      const t = E.engine.layout(
        doc([{ type: 'block', writingMode: 'vertical-rl', height: 100, fontSize: 20, lineHeight: 1.5, primaryFontMetrics: true, ...(noStrut ? { noStrut: true } : {}), children: [{ type: 'inline', fontSize: 8, lineHeight: 1, children: ['あい'] }] } as never]),
      );
      const ls: Area[] = [];
      walk(t.sheets[0].page.regionBody as unknown as Area, (a) => {
        if (a.type === 'line') ls.push(a);
      });
      return ls[0].width;
    };
    // 支柱: 20pt × 1.5 = 30pt。支柱が無ければ、8pt の字の幅だけ
    expect(lineW(false)).toBeCloseTo(30, 1);
    expect(lineW(true)).toBeCloseTo(8, 1);
  });
});

describe('組版の規格どおりでない動き (全体のレビュー)', () => {
  it('collapse の表で、行ごとにセルの数が違っても、欠けたセルとの境目の罫線を描く', async () => {
    const { collapseTableBorders } = await import('../src/tableBorders');
    const b = { width: 1, color: '#000000' };
    const cell = (s: string) => ({ type: 'table-cell', border: { top: b, right: b, bottom: b, left: b }, children: [{ type: 'block', children: [s] }] });
    const t = collapseTableBorders(
      { type: 'table', borderCollapse: 'collapse', columns: [{ type: 'table-column' }, { type: 'table-column' }], body: { type: 'table-body', rows: [{ type: 'table-row', cells: [cell('A'), cell('B')] }, { type: 'table-row', cells: [cell('C')] }] } } as never,
      'horizontal-tb',
    );
    const rows = (t as unknown as { body: { rows: Array<{ cells: Array<{ border: Record<string, { collapse?: { noPaint?: boolean } }> }> }> } }).body.rows;
    expect(rows[0].cells[1].border.bottom.collapse?.noPaint).toBeFalsy(); // B の下
    expect(rows[1].cells[0].border.right.collapse?.noPaint).toBeFalsy(); // C の右
  });

  it('page-position="rest" は最後のページに当てない (§7.27.14)', () => {
    const m = (h: number) => master({ height: h });
    const t = E.engine.layout({
      type: 'document',
      sequences: [
        {
          type: 'page-sequence',
          master: m(103),
          masterAlternatives: [
            { when: { pagePosition: 'first' }, master: m(101) },
            { when: { pagePosition: 'rest' }, master: m(102) },
            { when: {}, master: m(103) },
          ],
          flow: { type: 'flow', children: [1, 2, 3].map((k) => ({ type: 'block', breakBefore: k > 1 ? 'page' : undefined, children: [`p${k}`] })) },
        },
      ],
    } as never);
    expect(t.sheets.map((s) => Math.round((s.page.height * 25.4) / 72))).toEqual([101, 102, 103]);
  });

  it('first・rest だけの指定なら、最後のページは rest のマスター (当てはまるものが無いときの選び直し)', () => {
    const m = (h: number) => master({ height: h });
    const t = E.engine.layout({
      type: 'document',
      sequences: [
        {
          type: 'page-sequence',
          master: m(101),
          masterAlternatives: [
            { when: { pagePosition: 'first' }, master: m(101) },
            { when: { pagePosition: 'rest' }, master: m(102) },
          ],
          flow: { type: 'flow', children: [1, 2].map((k) => ({ type: 'block', breakBefore: k > 1 ? 'page' : undefined, children: [`p${k}`] })) },
        },
      ],
    } as never);
    expect(t.sheets.map((s) => Math.round((s.page.height * 25.4) / 72))).toEqual([101, 102]);
  });

  it('keep-with-next の見出しの入れ子が深くても、試し組みの手間が指数的に増えない', async () => {
    const { vi } = await import('vitest');
    const nest = (d: number, keep: boolean): unknown =>
      d === 0 ? { type: 'block', children: ['本文'.repeat(50)] } : { type: 'block', children: [{ type: 'block', keepWithNext: keep, children: [`見出し${d}`] }, nest(d - 1, keep), nest(d - 1, keep)] };
    // 時間でなく、回数で確かめる (混んだ機械でも変わらない)。keep-with-next の無い同じ文書と比べる:
    //  - 字を測った回数 (Measurer.glyph) は同じ (試し組みは、覚えてある行分けの結果を使い、字を測り直さない)
    //  - 段落の行分けを引いた・覚えた回数 (行分けの覚えが、引くとき・入れるときに 1 度ずつ Measurer.version を呼ぶ) は、
    //    keep-with-next の無い文書の 3 倍まで (今は 2.4 倍ほど。試し組みの中でさらに試し組みをすると、入れ子の深さとともに増える。深さ 8 で 5 倍を超える)
    const count = (keep: boolean) => {
      const glyph = vi.spyOn(E.measurer, 'glyph');
      const version = vi.spyOn(E.measurer, 'version');
      try {
        const t = E.engine.layout(doc([nest(8, keep)] as never));
        return { glyph: glyph.mock.calls.length, version: version.mock.calls.length, sheets: t.sheets.length };
      } finally {
        glyph.mockRestore();
        version.mockRestore();
      }
    };
    const plain = count(false);
    const kept = count(true);
    expect(plain.glyph).toBeGreaterThan(10000);
    expect(kept.glyph).toBe(plain.glyph);
    expect(kept.version).toBeGreaterThan(plain.version); // 試し組みをしている (数えている量が、試し組みで増える量であること)
    expect(kept.version).toBeLessThan(plain.version * 3);
    expect(kept.sheets).toBeGreaterThanOrEqual(plain.sheets);
  }, 120_000);
});

describe('行の組版の規格どおりでない動き (全体のレビュー)', () => {
  const linesOf = (t: ReturnType<typeof E.engine.layout>) => {
    const out: string[] = [];
    walk(t.sheets[0].page.regionBody, (a) => {
      if (a.type !== 'line') return;
      let s = '';
      walk(a, (g) => {
        if (g.type === 'glyph') s += (g as GlyphArea).text;
      });
      out.push(s);
    });
    return out;
  };
  it('ソフトハイフン (U+00AD) は見えず、そこで改行したときだけ行末にハイフンを出す (CSS Text 3 §5.3)', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 60, children: ['abcdefgh­ijklmnop'] }] as never));
    const ls = linesOf(t);
    expect(ls[0]).toBe('abcdefgh-');
    expect(ls.join('')).not.toContain('­');
    const one = linesOf(E.engine.layout(doc([{ type: 'block', children: ['ab­cd'] }] as never)));
    expect(one).toEqual(['abcd']);
  });
  it('word-break: break-all でも、小書きの仮名・長音記号の前では改行しない', () => {
    const t = E.engine.layout(doc([{ type: 'block', width: 40, wordBreak: 'break-all', children: ['あいちょっとかなー'] }] as never));
    for (const l of linesOf(t)) expect(/^[ょっー]/.test(l)).toBe(false);
  });
});

describe('背景画像の右・下の端からの位置 (background-position: right 10px bottom 5px)', () => {
  it('右の端・下の端から内側へ距離をとって置く', async () => {
    const assets = new AssetStore();
    assets.registerSize('bg.png', 40, 20); // 30×15pt
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
    const t = engine.layout(doc([{ type: 'block', width: 90, height: 45, boxSizing: 'border-box', backgroundImage: { src: 'bg.png', repeat: 'no-repeat', x: 10, y: 5, xFromEnd: true, yFromEnd: true }, children: ['あ'] }] as never));
    const at: Array<[number, number]> = [];
    let ox = 0;
    let oy = 0;
    const p = {
      fillRect() {},
      drawGlyph() {},
      drawImage: (a: ImageArea, x: number, y: number) => {
        if (a.src === 'bg.png') at.push([x, y]);
      },
      transform: (_m: unknown, d: () => void) => d(),
      strokeLine() {},
      clipRect(r: { x: number; y: number }) {
        [ox, oy] = [r.x, r.y];
      },
      restore() {},
    };
    const { paintSheet } = await import('../src/paint');
    paintSheet(t.sheets[0], p as never, { guides: false });
    expect(at.length).toBe(1);
    expect(at[0][0] - ox).toBeCloseTo(90 - 30 - 10);
    expect(at[0][1] - oy).toBeCloseTo(45 - 15 - 5);
  });
});

describe('双方向のテキストの並べ替え (UAX #9)', () => {
  const glyphs = (t: ReturnType<typeof E.engine.layout>) => {
    const out: Array<{ ch: string; x: number }> = [];
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph') out.push({ ch: (a as GlyphArea).text, x });
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
    return out;
  };
  it('左から右の段落の中のヘブライ語の語は、右から左に並べる', () => {
    const g = glyphs(E.engine.layout(doc([{ type: 'block', textAlign: 'start', children: ['ab אבג cd'] }] as never)));
    const x = (ch: string) => g.find((v) => v.ch === ch)!.x;
    expect(x('b')).toBeLessThan(x('ג'));
    expect(x('ג')).toBeLessThan(x('ב'));
    expect(x('ב')).toBeLessThan(x('א'));
    expect(x('א')).toBeLessThan(x('c'));
  });
  it('右から左の段落の括弧は、鏡像の字にする (L4)', () => {
    const g = glyphs(E.engine.layout(doc([{ type: 'block', direction: 'rtl', textAlign: 'start', children: ['א(ב)'] }] as never)));
    // 論理の順で「(」の字は、右から左では「)」の形で、א の左に置く
    const x = (ch: string) => g.find((v) => v.ch === ch)!.x;
    expect(g.map((v) => v.ch).sort()).toEqual(['(', ')', 'א', 'ב'].sort());
    expect(x(')')).toBeLessThan(x('א'));
    expect(x('ב')).toBeLessThan(x(')'));
    expect(x('(')).toBeLessThan(x('ב'));
  });
});

describe('inline の unicode-bidi (Writing Modes 3 §2.2・§2.4.2)', () => {
  const xs = (children: unknown[], block: object = {}) => {
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', ...block, children } as never]));
    const out: Array<{ ch: string; x: number }> = [];
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph') out.push({ ch: (a as GlyphArea).text, x });
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
    return out.sort((p, q) => p.x - q.x).map((v) => v.ch).join('');
  };
  it('bidi-override の rtl は、中の字を右から左に並べる (欧文も)', () => {
    expect(xs(['a', { type: 'inline', direction: 'rtl', unicodeBidi: 'bidi-override', children: ['bcd'] }, 'e'])).toBe('adcbe');
  });
  it('isolate-override も、外の並べ方は変えずに中を上書きする', () => {
    expect(xs(['a', { type: 'inline', direction: 'rtl', unicodeBidi: 'isolate-override', children: ['bc'] }, 'd'])).toBe('acbd');
  });
  it('embed の rtl の中の欧文は左から右のまま、埋め込みの終わりの中立の字は右から左の側', () => {
    // 右から左の埋め込みの中の「ab!」: ab は L (深さ 2)、! は埋め込みの向き (深さ 1) なので ab の左に来る
    expect(xs(['x ', { type: 'inline', direction: 'rtl', unicodeBidi: 'embed', children: ['ab!'] }])).toBe('x !ab');
    // 埋め込みが無ければ、! は ab の右
    expect(xs(['x ', { type: 'inline', direction: 'rtl', children: ['ab!'] }])).toBe('x ab!');
  });
  it('block の bidi-override は中身の全体、plaintext は最初の強い字で段落の向きを決める', () => {
    expect(xs(['abc'], { direction: 'rtl', unicodeBidi: 'bidi-override' })).toBe('cba');
    // 左から右の指定でも、最初の強い字がヘブライ文字なら右から左の段落 (数字の並びは左から右)
    expect(xs(['אב 12'], { unicodeBidi: 'plaintext' })).toBe('12 בא');
  });
});

describe('縦書きの行の双方向の並べ替え', () => {
  it('縦書きの行の中のヘブライ語の語は、下から上 (右から左と同じ向き) に並べる', () => {
    const t = E.engine.layout(doc([{ type: 'block', children: ['あאבגい'] }] as never, 'vertical-rl'));
    const ys = new Map<string, number>();
    const visit = (a: Area, oy: number) => {
      const y = oy + a.y;
      if (a.type === 'glyph') ys.set((a as GlyphArea).text, y);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, y);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
    const y = (ch: string) => ys.get(ch)!;
    expect(y('あ')).toBeLessThan(y('ג'));
    expect(y('ג')).toBeLessThan(y('ב'));
    expect(y('ב')).toBeLessThan(y('א'));
    expect(y('א')).toBeLessThan(y('い'));
  });
});

describe('CSS のグラデーションの背景 (CSS Images 3 §3)', () => {
  it('箱の大きさが決まったところで SVG の画像にして、画像の置き場に登録する (同じものは 1 つ)', () => {
    const assets = new AssetStore();
    const engine = new LayoutEngine(E.fonts, E.measurer, { defaultFontFamily: FAMILY, assets });
    const g = { src: '', gradient: 'linear-gradient(to right, red, blue)' };
    const t = engine.layout(doc([
      { type: 'block', width: 90, height: 45, boxSizing: 'border-box', backgroundImage: g, children: ['あ'] },
      { type: 'block', width: 90, height: 45, boxSizing: 'border-box', backgroundImage: { ...g }, children: ['い'] },
    ] as never));
    const found: Array<{ src: string; width?: number; height?: number; gradient?: string }> = [];
    const visit = (a: unknown) => {
      if (!a || typeof a !== 'object') return;
      const bi = (a as { backgroundImage?: (typeof found)[number] }).backgroundImage;
      if (bi) found.push(bi);
      for (const v of Object.values(a)) if (v && typeof v === 'object' && v !== bi) (Array.isArray(v) ? v.forEach(visit) : visit(v));
    };
    t.sheets.forEach(visit);
    expect(found.length).toBe(2);
    expect(found.every((b) => b.src === 'kumiori-gradient-1.svg' && b.gradient === undefined)).toBe(true);
    expect([found[0].width, found[0].height]).toEqual([90, 45]);
    const asset = assets.get('kumiori-gradient-1.svg')!;
    expect(asset.mime).toBe('image/svg+xml');
    expect(new TextDecoder().decode(asset.bytes)).toContain('<linearGradient');
  });
});
