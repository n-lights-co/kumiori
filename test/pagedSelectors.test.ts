/**
 * ページまわりの CSS の回帰テスト:
 *  - @page :nth(An+B [of 名前]) (CSS GCPM 3 §3.1): 文書の先頭からのページの順・名前付きページの組の中の順で、ページの規則を当てる
 *  - page-orientation (CSS Paged Media 3 §7.1.2): 組んだ後に出力のページを回す (PDF の /Rotate)。組み方は変えない
 *  - marks の crop と cross の区別 (CSS Paged Media 3 §7.2): crop は角のトンボ、cross は十字のトンボだけを描く
 *  - target-counters() (CSS Content 3 §2.6.2): 参照先の入れ子のカウンターの値を区切りの字でつなぐ
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { DEFAULT_FONTS, typesetHtml, childrenOf } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { trimMarkLines } from '../src/paint';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
}, 300_000);

const doc = (body: string, css = '') =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>t</title><style>@page { size: 300pt 300pt; margin: 30pt } body { margin: 0; font-size: 10pt } p { margin: 0 } .pb { break-before: page } ${css}</style></head><body>${body}</body></html>`;
const run = (body: string, css = '') => typesetHtml(doc(body, css), { loadFont: loadCachedFont });

/** ページの字 (テキストの並び) */
function textOf(tree: AreaTree, sheet: number): string {
  let s = '';
  const rec = (a: Area) => {
    if (a.type === 'glyph') s += (a as unknown as { text?: string }).text ?? '';
    for (const c of childrenOf(a)) rec(c as Area);
  };
  rec(tree.sheets[sheet].page as unknown as Area);
  return s;
}
/** ページの本文領域の左上 (ページの余白) */
const bodyOrigin = (tree: AreaTree, sheet: number) => {
  const body = childrenOf(tree.sheets[sheet].page as unknown as Area).find((a) => (a as Area).type === 'region-body') as Area | undefined;
  return { x: Math.round((body?.x ?? NaN) * 1000) / 1000, y: Math.round((body?.y ?? NaN) * 1000) / 1000 };
};

const fivePages = '<p>1</p><p class="pb">2</p><p class="pb">3</p><p class="pb">4</p><p class="pb">5</p>';

describe('@page :nth() (CSS GCPM 3 §3.1)', () => {
  it(':nth(2n+1) は奇数番目のページ、:nth(2) は 2 ページ目だけ', async () => {
    const t = (await run(fivePages, '@page :nth(2n+1) { margin-left: 50pt } @page :nth(2) { margin-left: 70pt }')).areaTree;
    expect([0, 1, 2, 3, 4].map((k) => bodyOrigin(t, k).x)).toEqual([50, 70, 50, 30, 50]);
  });
  it('2 つの :nth() に合うページは、両方の規則を詳細度と順で重ねる', async () => {
    const t = (await run(fivePages, '@page :nth(odd) { margin-left: 50pt } @page :nth(3n) { margin-top: 60pt }')).areaTree;
    expect([0, 1, 2].map((k) => bodyOrigin(t, k))).toEqual([{ x: 50, y: 30 }, { x: 30, y: 30 }, { x: 50, y: 60 }]);
  });
  it(':nth() の詳細度は :first と同じ (後に書いたものが勝つ)。:left・:right より高い', async () => {
    const t = (await run(fivePages, '@page :nth(1) { margin-left: 50pt } @page :first { margin-left: 40pt } @page :nth(2) { margin-left: 45pt } @page :left { margin-left: 35pt }')).areaTree;
    expect([0, 1, 2, 3].map((k) => bodyOrigin(t, k).x)).toEqual([40, 45, 30, 35]);
  });
  it(':nth(1 of 名前) は、名前付きページの組の中の順。名前の無い :nth() は文書の先頭からの順', async () => {
    const body = '<p>a</p><section style="page: ch"><p>b</p><p class="pb">c</p></section><p class="pb">d</p>';
    const t = (await run(body, '@page :nth(1 of ch) { margin-left: 50pt } @page :nth(1) { margin-top: 60pt }')).areaTree;
    expect(t.sheets.length).toBe(4);
    expect([0, 1, 2, 3].map((k) => bodyOrigin(t, k))).toEqual([{ x: 30, y: 60 }, { x: 50, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 30 }]);
  });
  it('同じ名前のページの組が続くとき (page と強制の改ページを持つ章の要素ごと)、:nth(… of 名前) の順を組ごとに数え直す (GCPM 3 §3.2)', async () => {
    // 章ごとに :nth(1 of ch) を当てる (名前は変わらないが、章の要素ごとに組が始まる)。2 ページ目の :nth(2 of ch) も、章ごと
    const body = '<section style="page: ch"><p>1</p><p class="pb">2</p></section><section style="page: ch; break-before: page"><p>3</p><p class="pb">4</p></section><p class="pb">5</p>';
    const t = (await run(body, '@page :nth(1 of ch) { margin-left: 50pt } @page ch:nth(2 of ch) { margin-left: 70pt }')).areaTree;
    expect(t.sheets.map((_, k) => textOf(t, k)[0])).toEqual(['1', '2', '3', '4', '5']);
    expect([0, 1, 2, 3, 4].map((k) => bodyOrigin(t, k).x)).toEqual([50, 70, 50, 70, 30]);
    // 名前付きの :first は、組だけで分けた所 (名前の変わらない所) には当てない (名前の変わる所で分けたページの並びの最初のページ)。ページ番号は続く
    const f = await run(body, '@page :nth(1 of ch) { margin-left: 50pt } @page ch:first { margin-top: 60pt } @page { @bottom-center { content: counter(page) } }');
    expect([0, 1, 2, 3, 4].map((k) => bodyOrigin(f.areaTree, k).y)).toEqual([60, 30, 30, 30, 30]);
    expect([0, 1, 2, 3, 4].map((k) => textOf(f.areaTree, k))).toEqual(['11', '22', '33', '44', '55']);
    // :nth(… of 名前) の無い文書は、組で分けない (前と同じ)
    const plain = await run(body, '@page ch:first { margin-top: 60pt }');
    expect([0, 1, 2, 3, 4].map((k) => bodyOrigin(plain.areaTree, k).y)).toEqual([60, 30, 30, 30, 30]);
  });
  it('読めない引数の :nth() は、どのページにも当たらない。未対応の警告は出さない', async () => {
    const r = await run(fivePages, '@page :nth(foo) { margin-left: 50pt }');
    expect(bodyOrigin(r.areaTree, 0).x).toBe(30);
    expect(r.warnings.some((w) => /未対応/.test(w))).toBe(false);
  });
});

describe('page-orientation (CSS Paged Media 3 §7.1.2)', () => {
  it('rotate-left は /Rotate 270、rotate-right は /Rotate 90。組み方 (ページの大きさ) は変えない', async () => {
    const css = '@page wide { page-orientation: rotate-left } @page tall { page-orientation: rotate-right } .w { page: wide } .t { page: tall }';
    const r = await run('<p>a</p><p class="w">b</p><p class="t">c</p>', css);
    expect(r.areaTree.sheets.map((s) => [s.width, s.height, s.rotation])).toEqual([[300, 300, undefined], [300, 300, 270], [300, 300, 90]]);
    const pdf = await PDFDocument.load(await r.toPdf());
    expect(pdf.getPages().map((p) => (p.node.get(PDFName.of('Rotate')) as PDFNumber | undefined)?.asNumber())).toEqual([undefined, 270, 90]);
    expect(r.warnings.some((w) => /page-orientation/.test(w))).toBe(false);
  });
});

describe('marks の crop と cross (CSS Paged Media 3 §7.2)', () => {
  const sheet = async (marks: string) => (await run('<p>a</p>', `@page { marks: ${marks}; bleed: 3mm }`)).areaTree.sheets[0];
  it('crop だけなら角のトンボだけ、cross だけなら十字のトンボだけ、両方なら両方', async () => {
    const crop = await sheet('crop');
    const cross = await sheet('cross');
    const both = await sheet('crop cross');
    expect([crop.cornerMarks, crop.centerMarks]).toEqual([undefined, false]);
    expect([cross.cornerMarks, cross.centerMarks]).toEqual([false, undefined]);
    expect([both.cornerMarks, both.centerMarks]).toEqual([undefined, undefined]);
    // 角のトンボは 4 隅 × 4 本、十字のトンボは各辺 3 本 (中心線と十字の 2 本)
    expect(trimMarkLines(crop).length).toBe(16);
    expect(trimMarkLines(both).length).toBe(trimMarkLines(crop).length + trimMarkLines(cross).length);
  });
});

describe('target-counters() (CSS Content 3 §2.6.2)', () => {
  it('参照先の入れ子のカウンターを外から区切りの字でつなぎ、数え方を当てる', async () => {
    const css = 'ol { counter-reset: item; list-style: none } li { counter-increment: item } a::after { content: "[" target-counters(attr(href url), item, ".") "|" target-counters(attr(href url), item, "-", upper-roman) "]" }';
    const body = '<ol><li>x<ol><li>y</li><li id="t">z</li></ol></li></ol><p><a href="#t">r</a></p>';
    const r = await run(body, css);
    expect(textOf(r.areaTree, 0)).toContain('r[1.2|I-II]');
    expect(r.warnings.some((w) => /target-counters/.test(w))).toBe(false);
  });
  it('参照先にそのカウンターが無ければ 0。page はページ番号', async () => {
    const css = 'a::after { content: "(" target-counters(attr(href url), nothing, ".") "/" target-counters(attr(href url), page, ".") ")" }';
    const r = await run('<p><a href="#t">r</a></p><p class="pb" id="t">t</p>', css);
    expect(textOf(r.areaTree, 0)).toContain('r(0/2)');
  });
});

describe('footnote-policy (CSS GCPM 3 §2.8)', () => {
  // 本文の高さ 240pt (行 12pt × 20 行)。前置きの 14 行の後に、4 行の段落。4 行目の脚注 (6 行) は、その行と同じページに入らない
  const filler = '<p style="height: 168pt">x</p>';
  const para = (policy: string) =>
    `${filler}<p style="orphans: 1; widows: 1">a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 a1 Z<span class="fn" style="footnote-policy: ${policy}">F1<br>F2<br>F3<br>F4<br>F5<br>F6</span></p>`;
  const css = 'body { line-height: 12pt } .fn { float: footnote }';
  it('block は参照を含む段落の前で改ページし、段落を丸ごと次のページに置く。auto・line は参照の行の前で切る', async () => {
    const pages = async (policy: string) => {
      const t = (await run(para(policy), css)).areaTree;
      return t.sheets.map((_, k) => textOf(t, k));
    };
    const auto = await pages('auto');
    expect(auto[0]).toContain('a1');
    expect(auto[1]).toContain('Z');
    expect(await pages('line')).toEqual(auto);
    const block = await pages('block');
    expect(block[0]).not.toContain('a1');
    expect(block[1]).toContain('a1');
    expect(block[1]).toContain('F6');
  });
  it('line は、脚注の領域の上限 (max-height) で脚注を分けずに、参照の行ごと次のページに置く (auto は分けて続ける)', async () => {
    const mx = `${css} @page { @footnote { max-height: 14pt } }`;
    const auto = (await run(para('auto'), mx)).areaTree;
    const line = (await run(para('line'), mx)).areaTree;
    // auto: 参照の行はこのページ、脚注の残りは次のページ
    expect(textOf(auto, 0)).toContain('Z');
    expect(textOf(auto, 0)).not.toContain('F6');
    // line: 参照の行と脚注の頭は次のページ (次のページでも上限に入らない脚注は、auto と同じに分けて続ける)
    expect(textOf(line, 0)).not.toContain('Z');
    expect(textOf(line, 0)).not.toContain('F1');
    expect(textOf(line, 1)).toContain('Z');
    expect(textOf(line, 1)).toContain('F1');
  });
  it('回り込みの横の行の参照も、block は段落の前、line は上限で分けずに参照の行の前で改ページする', async () => {
    const side = (policy: string) => para(policy).replace(filler, `${filler}<div style="float: left; width: 30pt; height: 60pt"></div>`);
    const pages = async (policy: string, more = '') => {
      const t = (await run(side(policy), css + more)).areaTree;
      return t.sheets.map((_, k) => textOf(t, k));
    };
    const block = await pages('block');
    expect(block[0]).not.toContain('a1');
    expect(block[1]).toContain('a1');
    expect(block[1]).toContain('F6');
    const auto = await pages('auto');
    expect(auto[0]).toContain('a1');
    const mx = ' @page { @footnote { max-height: 14pt } }';
    const lineMx = await pages('line', mx);
    expect(lineMx[0]).not.toContain('Z');
    expect(lineMx[1]).toContain('Z');
    expect((await pages('auto', mx))[0]).toContain('Z');
  });
  it('未対応の警告に出さない', async () => {
    const r = await run(para('block'), css);
    expect(r.warnings.some((w) => /footnote-policy/.test(w))).toBe(false);
  });
});

describe('文書の最初の箱の左右の強制の区切り (CSS Paged Media 3 §3.3)', () => {
  const css = '@page :left { margin-left: 50pt } @page :first { margin-top: 60pt }';
  it('break-before: left は空のページを挟まずに、最初のページを左ページにする (:first も最初に出すページに当たる)', async () => {
    const t = (await run('<h1 style="break-before: left">A</h1><p class="pb">B</p>', css)).areaTree;
    expect(t.sheets.length).toBe(2);
    expect([0, 1].map((k) => bodyOrigin(t, k))).toEqual([{ x: 50, y: 60 }, { x: 30, y: 30 }]);
    expect(textOf(t, 0)).toContain('A');
  });
  it('入れ子の最初の子の区切りも伝わる。right は最初のページのまま (右ページ)', async () => {
    const left = (await run('<section><div><h1 style="break-before: verso">A</h1></div></section>', css)).areaTree;
    expect(left.sheets.length).toBe(1);
    expect(bodyOrigin(left, 0).x).toBe(50);
    const right = (await run('<h1 style="break-before: right">A</h1>', css)).areaTree;
    expect(right.sheets.length).toBe(1);
    expect(bodyOrigin(right, 0).x).toBe(30);
  });
  it('前に中身があれば、これまでどおり白ページを挟む', async () => {
    const t = (await run('<p>x</p><h1 style="break-before: right">A</h1>', css)).areaTree;
    expect(t.sheets.length).toBe(3);
  });
});

describe('@page の背景と根元の要素の背景 (CSS Paged Media 3 §3.1)', () => {
  it('@page に背景があっても、根元の要素の背景をページ領域に重ねて描く', async () => {
    const r = await run('<p>a</p>', '@page { background: #ff0000 } html { background: #00ff00 }');
    const sh = r.areaTree.sheets[0];
    expect(sh.backgroundColor).toBe('#ff0000');
    expect(sh.rootBackground?.backgroundColor).toBe('#00ff00');
    expect(sh.rootBackground?.box).toEqual({ x: 30, y: 30, width: 240, height: 240 });
  });
  it('@page に背景が無ければ、これまでどおり根元の要素の背景をページの背景にする', async () => {
    const sh = (await run('<p>a</p>', 'html { background: #00ff00 }')).areaTree.sheets[0];
    expect(sh.backgroundColor).toBe('#00ff00');
    expect(sh.rootBackground).toBeUndefined();
  });
});
