import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { parseCss, resolvePageRules } from '../src/htmlPaged';

/** 全体のレビューで見つけた CSS の読み方の誤り */

const doc = (body: string) => new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
const styleOf = (body: string, css: string, id = 'a') => {
  const d = doc(body);
  const st = cascadeStyles(d, css, { viewport: { width: 600, height: 800 } });
  return (prop: string) => st.style(d.getElementById(id)!).getPropertyValue(prop);
};
const flow = (body: string, css = '') => {
  const d = doc(body);
  return JSON.stringify(importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css }).document.sequences[0].flow.children);
};

describe('CSS の字句と規則', () => {
  it('範囲外の 16 進の逃がしは U+FFFD にする (変換を止めない。CSS Syntax 3 §4.3.7)', () => {
    expect(styleOf('<p id="a">x</p>', 'p::before{content:"\\110000"} #a{color:red}')('color')).toBe('rgb(255, 0, 0)');
    expect(flow('<p>x</p>', 'p::before{content:"\\110000"}')).toContain('\ufffd');
  });
  it('閉じていない文字列は改行で終わり、残りの規則を飲み込まない', () => {
    expect(styleOf('<p id="a">x</p>', 'p{content:"oops\n} #a{color:red}')('color')).toBe('rgb(255, 0, 0)');
  });
  it('カスタム プロパティの名前は大文字・小文字を区別する (CSS Variables 1 §2)', () => {
    expect(styleOf('<p id="a">x</p>', ':root{--Main:red} #a{color:var(--Main)}')('color')).toBe('rgb(255, 0, 0)');
  });
  it('セレクタの 16 進の逃がしは、後ろの空白 1 つまでを含む', () => {
    expect(styleOf('<p id="a" class="1a">x</p>', '.\\31 a{color:red}')('color')).toBe('rgb(255, 0, 0)');
  });
  it('@supports は、知らない性質の宣言を偽とする (Conditional 3 §6)', () => {
    expect(styleOf('<p id="a">x</p>', '@supports not (foo-bar:baz){#a{color:red}}')('color')).toBe('rgb(255, 0, 0)');
    expect(styleOf('<p id="a">x</p>', '@supports (foo-bar:baz){#a{color:red}}')('color')).toBe('rgb(0, 0, 0)');
  });
  it('メディアクエリの範囲の書き方 (Media Queries 4 §2.4.4)', () => {
    expect(styleOf('<p id="a">x</p>', '@media (width >= 100px){#a{color:red}}')('color')).toBe('rgb(255, 0, 0)');
    expect(styleOf('<p id="a">x</p>', '@media (10px < width < 100px){#a{color:red}}')('color')).toBe('rgb(0, 0, 0)');
  });
  it('入れ子の @media は、親のセレクタに当て、親の宣言より後に並べる (CSS Nesting 1)', () => {
    expect(styleOf('<p id="a">x</p>', '#a{color:blue; @media print{color:red}}')('color')).toBe('rgb(255, 0, 0)');
  });
  it('@layer: 層の無い規則が勝ち、層の間では後の層が勝つ (Cascade 5 §6.4)', () => {
    expect(styleOf('<p id="a">x</p>', '@layer base, comp; @layer comp{#a{color:red}} @layer base{#a{color:blue}}')('color')).toBe('rgb(255, 0, 0)');
    expect(styleOf('<p id="a">x</p>', '#a{color:red} @layer x{#a{color:blue}}')('color')).toBe('rgb(255, 0, 0)');
    expect(styleOf('<p id="a">x</p>', '#a{color:red !important} @layer x{#a{color:blue !important}}')('color')).toBe('rgb(0, 0, 255)');
  });
  it('hsl() の色相の単位 (turn・rad)', () => {
    expect(styleOf('<p id="a">x</p>', '#a{color:hsl(0.5turn 100% 50%)}')('color')).toBe('rgb(0, 255, 255)');
  });
});

describe('論理的な性質 (Logical 1)', () => {
  it('border-block-start は書字方向で物理の辺に写す', () => {
    expect(styleOf('<p id="a">x</p>', '#a{writing-mode:vertical-rl;border-block-start:3px solid red}')('border-right-width')).toBe('3px');
    expect(styleOf('<p id="a">x</p>', '#a{border-inline-start-width:5px;border-inline-start-style:solid}')('border-left-width')).toBe('5px');
  });
});

describe('@page', () => {
  it('セレクタの並びは、それぞれに当てる (Page 3 §4.3)', () => {
    const { pages } = parseCss('@page :left, :right { margin: 1in }');
    expect(pages.map((p) => p.pseudos.join())).toEqual(['left', 'right']);
  });
  it('後の規則の margin の一括指定は、前の規則の margin-top を上書きする', () => {
    const { pages } = parseCss('@page { margin: 20mm; margin-top: 5mm } @page :first { margin: 30mm }');
    expect(resolvePageRules(pages, { first: true }).decls['margin-top']).toBe('30mm');
  });
});

describe('生成内容とリスト', () => {
  it('引用符は入れ子の深さと quotes で選ぶ (Content 3 §4.1)', () => {
    expect(flow('<p lang="ja"><q>a<q>b</q></q></p>')).toMatch(/「a.*『b』.*」/);
    expect(flow('<p><q>a</q></p>', 'q{quotes:"<" ">"}')).toContain('<a>');
  });
  it('ol の start は 0 でもよい', () => {
    expect(flow('<ol start="0"><li>a</li></ol>')).toContain('"0."');
  });
});

describe('文字の変換と行分け', () => {
  it('text-transform の組み合わせと full-size-kana (CSS Text 3 §2.1)', async () => {
    const { applyTextTransform } = await import('../src/textTransform');
    expect(applyTextTransform('abc', 'uppercase full-width')).toBe('ＡＢＣ');
    expect(applyTextTransform('ｶﾞｧ', 'full-width full-size-kana')).toBe('ガア');
    expect(applyTextTransform('ちょっと', 'full-size-kana')).toBe('ちよつと');
  });
});

describe('余白の箱の幅 (Page 3 §5.3.2)', () => {
  const boxesOf = (css: string) => {
    const d = doc('<p>x</p>');
    const r = importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css, measureText: (t, st) => t.length * st.fontSize * 0.5 });
    return (r.document.sequences[0].staticContent ?? []).filter((b) => b.absolutePosition && b.top === 0) as Array<{ left: number; width: number }>;
  };
  it('B が無ければ、A と C で内容の幅に比べて分け、A は左端・C は右端に置く', () => {
    const bs = boxesOf('@page { size: 200mm 100mm; margin: 20mm; @top-left { content: "AAAAAAAA" } @top-right { content: "CC" } }');
    expect(bs).toHaveLength(2);
    const [a, c] = bs.sort((p, q) => p.left - q.left);
    expect(a.left).toBeCloseTo((20 * 72) / 25.4, 1);
    expect(a.width).toBeGreaterThan(c.width * 3);
    expect(c.left + c.width).toBeCloseTo((180 * 72) / 25.4, 1);
  });
  it('B があれば、B を中央に置き、A・C は残りを半分ずつ', () => {
    const bs = boxesOf('@page { size: 200mm 100mm; margin: 20mm; @top-left { content: "A" } @top-center { content: "BBBB" } @top-right { content: "C" } }');
    const [a, b, c] = bs.sort((p, q) => p.left - q.left);
    const mid = (100 * 72) / 25.4;
    expect(b.left + b.width / 2).toBeCloseTo(mid, 1);
    expect(a.width).toBeCloseTo(c.width, 3);
    expect(a.width + b.width + c.width).toBeCloseTo((160 * 72) / 25.4, 1);
  });
});

describe('自前で読む宣言もカスケードで決める', () => {
  it('string-set は詳細度で、float: footnote は後の float: none で打ち消す', () => {
    const j = flow('<h1 id="i">T</h1><p class="n x">注</p>', '#i{string-set:t "Spec"} h1{string-set:t "Later"} .n{float:footnote} .n.x{float:none}');
    expect(j).toContain('"Spec"');
    expect(j).not.toContain('"Later"');
    expect(j).not.toContain('"type":"footnote"');
  });
  it('::before の content: url() は、後の詳細度の高い content で打ち消す', () => {
    const j = flow('<p class="x">本文</p>', 'p::before{content:url(a.png)} p.x::before{content:"T"}');
    expect(j).toContain('T本文');
    expect(j).not.toContain('a.png');
  });
});

describe('background-position の 3・4 値 (Backgrounds 3 §3.6)', () => {
  it('語の後の距離はその端から。3 値の欠けた距離は 0。右・下からの百分率は 100% から引く', () => {
    const xy = (v: string) => {
      const c = styleOf('<p id="a">x</p>', `#a { background-position: ${v} }`);
      return [c('background-position-x'), c('background-position-y')];
    };
    expect(xy('left 10px top 15px')).toEqual(['10px', '15px']);
    expect(xy('left top 15px')).toEqual(['0%', '15px']);
    expect(xy('left 10px top')).toEqual(['10px', '0%']);
    expect(xy('bottom 10px right 20px')).toEqual(['right 20px', 'bottom 10px']);
    expect(xy('right 25% bottom')).toEqual(['75%', '100%']);
    expect(xy('center top 5px')).toEqual(['50%', '5px']);
    // 並びが規格に合わないものは既定のまま
    expect(xy('center 10px top')).toEqual(['0%', '0%']);
  });
  it('右・下の端からの長さは、背景画像の位置に端からの距離として渡る', () => {
    const j = flow('<div style="width:200px;height:100px;background:url(a.png) no-repeat;background-position:right 20px bottom 10px">x</div>');
    expect(j).toContain('"xFromEnd":true');
    expect(j).toContain('"yFromEnd":true');
    expect(j).toContain('"x":15');
    expect(j).toContain('"y":7.5');
  });
});

describe('HTML の双方向のテキストの既定のスタイル (WHATWG 15.3.5)', () => {
  it('bdo は isolate-override、dir のある span は isolate', () => {
    const j = flow('<p>a<bdo dir="rtl">bc</bdo><span dir="rtl">d</span></p>');
    expect(j).toContain('"unicodeBidi":"isolate-override"');
    expect(j).toContain('"unicodeBidi":"isolate"');
  });
});
