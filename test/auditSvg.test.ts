import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import fontkit from '@pdf-lib/fontkit';
import { readMathFont, type FkFont, type MathFont } from '../src/mathFont';
import { layoutMathML, MAX_MATH_GLYPHS, type MNode } from '../src/mathLayout';
import { mathFontBuffer } from './helpers';
import { parseCss, parseSvg, svgNestTooDeep, SVG_MAX_NEST, type TextOutliner } from '../src/svg';

/**
 * SVG の読み取りが、小さな入力で時間・メモリを使い切らない:
 *  - 大きな path を use・clip-path・mask・pattern・marker・textPath で何度も引く (参照で増える線分の上限)
 *  - stop の多いグラデーションを多くの図形で使う、filter の入れ子、長い text・長い属性を持つ要素を use で何度も置く
 *  - <style> の規則 × 要素の総当たり (索引で引く。当てる順は変えない)
 *  - 深い入れ子 (解析の前に断る)
 *  - 数式: 多数の子 (mo の form を決めるときの読み直し)・多数の字 (描く字の数の上限)
 * 止まらないことは、結果と vitest の制限時間で確かめる (時間の差は測らない)
 */
const T = { timeout: 30_000 };

const parseXml = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const X = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const rep = (k: number, f: (i: number) => string) => Array.from({ length: k }, (_, i) => f(i)).join('');
/** 字 1 つを 4 つの線分の輪郭にする仮の書体 (送りは字の大きさ) */
const outline: TextOutliner = (text, _family, _weight, size) => {
  const n = [...text].length;
  return { segs: Array.from({ length: n * 4 }, (_, k) => ({ op: k % 4 ? ('L' as const) : ('M' as const), x: k, y: 0 })), advance: n * size };
};
const svgResult = (text: string, opts: Parameters<typeof parseSvg>[2] = {}) => {
  let why = '';
  const doc = parseSvg(text, parseXml, { ...opts, onUnsupported: (w) => (why = w) });
  return { doc, why };
};
const bigPath = (n: number) => `M0 0${rep(n, (i) => `l${i % 7} ${i % 5}`)}`;
const TOO_MANY = { doc: null, why: 'too many path segments' };

describe('SVG: 参照で増える線分の上限', () => {
  it('5 万点の path を use で 400 回置く SVG (212KB) は、図形にしない', T, () => {
    const s = `<svg ${X} viewBox="0 0 1000 1000"><defs><path id="p" d="${bigPath(50000)}"/></defs>${rep(400, (i) => `<use xlink:href="#p" x="${i % 100}"/>`)}</svg>`;
    expect(svgResult(s)).toEqual(TOO_MANY);
  });
  it('5 万点の clipPath を 400 個の図形に付ける SVG は、図形にしない', T, () => {
    const s = `<svg ${X} viewBox="0 0 1000 1000"><defs><clipPath id="c"><path d="${bigPath(50000)}"/></clipPath></defs>${rep(400, (i) => `<rect x="${i % 100}" width="5" height="5" clip-path="url(#c)"/>`)}</svg>`;
    expect(svgResult(s)).toEqual(TOO_MANY);
  });
  it('大きな path の mask・pattern・marker・textPath を何度も使う SVG は、図形にしない', T, () => {
    const mask = `<svg ${X} viewBox="0 0 1000 1000"><defs><mask id="k"><path fill="white" d="${bigPath(20000)}"/></mask></defs>${rep(200, (i) => `<rect x="${i % 100}" width="5" height="5" mask="url(#k)"/>`)}</svg>`;
    expect(svgResult(mask)).toEqual(TOO_MANY);
    const pattern = `<svg ${X} viewBox="0 0 1000 1000"><defs><pattern id="k" width="10" height="10" patternUnits="userSpaceOnUse"><path d="${bigPath(20000)}"/></pattern></defs>${rep(200, (i) => `<rect x="${i % 100}" width="5" height="5" fill="url(#k)"/>`)}</svg>`;
    expect(svgResult(pattern)).toEqual(TOO_MANY);
    const marker = `<svg ${X} viewBox="0 0 1000 1000"><defs><marker id="k" markerWidth="9" markerHeight="9"><path d="${bigPath(1500)}"/></marker></defs><path d="M0 0${rep(1000, (i) => `L${i % 999} ${i % 777}`)}" marker-mid="url(#k)" stroke="red"/></svg>`;
    expect(svgResult(marker)).toEqual(TOO_MANY);
    const textPath = `<svg ${X} viewBox="0 0 1000 1000"><defs><path id="p" d="M0 0${rep(20000, (i) => `c1 1 2 2 ${i % 3} 1`)}"/></defs>${rep(200, () => `<text font-size="1"><textPath xlink:href="#p">${'Ag'.repeat(50)}</textPath></text>`)}</svg>`;
    expect(svgResult(textPath, { outline })).toEqual(TOO_MANY);
  });
  it('文書に書かれたとおりの線分は数えない (30 万点の path を 5 つ。参照なし)', T, () => {
    const s = `<svg ${X} viewBox="0 0 1000 1000">${rep(5, () => `<path d="${bigPath(300_000)}"/>`)}</svg>`;
    const { doc } = svgResult(s);
    expect(doc!.shapes.map((sh) => sh.segs.length)).toEqual([300_001, 300_001, 300_001, 300_001, 300_001]);
  });
  it('記号を use で多く置く絵 (40 線分 × 2 万回 = 80 万線分) は、これまでどおり図形にする', T, () => {
    const s = `<svg ${X} viewBox="0 0 1000 1000"><defs><path id="p" d="M0 0${rep(38, (i) => `c1 1 2 2 ${i % 3} 1`)}z"/></defs>${rep(20000, (i) => `<use xlink:href="#p" x="${i % 900}" y="${(i * 7) % 900}"/>`)}</svg>`;
    const { doc } = svgResult(s);
    expect(doc!.shapes.length).toBe(20000);
    expect(doc!.shapes.every((sh) => sh.segs.length === 40)).toBe(true);
    // 置いた位置に写っている
    expect(doc!.shapes[901].segs[0]).toEqual({ op: 'M', x: 1, y: (901 * 7) % 900 });
  });
  it('図形ごとに同じ clip-path を付けた絵 (matplotlib の書き方) は、切り抜きを共有して、これまでどおり図形にする', T, () => {
    const s = `<svg ${X} viewBox="0 0 1000 1000"><defs><clipPath id="c"><rect width="500" height="500"/></clipPath></defs>${rep(20000, (i) => `<path d="M${i % 900} 0h5v5z" clip-path="url(#c)"/>`)}<g transform="translate(5)"><path d="M0 0h5v5z" clip-path="url(#c)"/></g></svg>`;
    const { doc } = svgResult(s);
    expect(doc!.shapes.length).toBe(20001);
    const clip = doc!.shapes[0].clips![0];
    expect(clip.segs).toEqual([{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 500, y: 0 }, { op: 'L', x: 500, y: 500 }, { op: 'L', x: 0, y: 500 }, { op: 'Z' }]);
    expect(doc!.shapes[19999].clips![0]).toBe(clip);
    // 座標系の違う所で使う切り抜きは、別の形 (その座標系に写したもの)
    expect(doc!.shapes[20000].clips![0].segs[0]).toEqual({ op: 'M', x: 5, y: 0 });
  });
  it('stop が 2 万個のグラデーションで 500 個の図形を塗る SVG は、図形にしない。数個の stop なら、これまでどおり', T, () => {
    const grad = (stops: number, rects: number) =>
      `<svg ${X} viewBox="0 0 1000 1000"><defs><linearGradient id="g">${rep(stops, (i) => `<stop offset="${(i / stops).toFixed(5)}" stop-color="#${((i * 7919) & 0xffffff).toString(16).padStart(6, '0')}"/>`)}</linearGradient></defs>${rep(rects, (i) => `<rect x="${i % 900}" width="9" height="9" fill="url(#g)"/>`)}</svg>`;
    expect(svgResult(grad(20000, 500))).toEqual(TOO_MANY);
    const { doc } = svgResult(grad(4, 5000));
    expect(doc!.shapes.length).toBe(5000);
    expect(doc!.shapes[4999].fillPaint!.stops).toEqual([
      { offset: 0, color: '#000000' },
      { offset: 0.25, color: '#001eef' },
      { offset: 0.5, color: '#003dde' },
      { offset: 0.75, color: '#005ccd' },
    ]);
    // 図形ごとに、その外接矩形に合わせた座標を持つ
    expect(doc!.shapes[4999].fillPaint!.matrix).toEqual([9, 0, 0, 9, 4999 % 900, 0]);
  });
  it('filter (影) の付いた g を 8 段重ねた SVG (6 の 8 乗の写し) は、図形にしない。1 段なら、影の写しを描く', T, () => {
    const s = (n: number) => `<svg ${X} viewBox="0 0 1000 1000"><defs><filter id="f"><feDropShadow dx="1" dy="1" stdDeviation="2"/></filter></defs>${'<g filter="url(#f)">'.repeat(n)}<rect width="50" height="50"/>${'</g>'.repeat(n)}</svg>`;
    expect(svgResult(s(8), { approximateFilters: true })).toEqual(TOO_MANY);
    expect(svgResult(s(1), { approximateFilters: true }).doc!.shapes.length).toBe(6);
  });
  it('2000 字の text を use で 3000 回置く SVG は、図形にしない。短い text を use で置くのは、これまでどおり', T, () => {
    const s = (chars: number, uses: number) => `<svg ${X} viewBox="0 0 1000 1000"><defs><text id="t" y="20" font-size="10">${'A'.repeat(chars)}</text></defs>${rep(uses, (i) => `<use xlink:href="#t" y="${i % 900}"/>`)}</svg>`;
    expect(svgResult(s(2000, 3000), { outline })).toEqual(TOO_MANY);
    const { doc } = svgResult(s(20, 3000), { outline });
    expect(doc!.shapes.length).toBe(3000);
    expect(doc!.shapes[2999].segs.length).toBe(80);
  });
  it('数十万字の属性 (stroke-dasharray) を持つ要素を use で 2000 回置く SVG は、図形にしない', T, () => {
    const s = `<svg ${X} viewBox="0 0 1000 1000"><defs><path id="p" d="M0 0h9" stroke="red" stroke-dasharray="${'1 2 '.repeat(50000)}"/></defs>${rep(2000, (i) => `<use xlink:href="#p" y="${i % 900}"/>`)}</svg>`;
    expect(svgResult(s)).toEqual({ doc: null, why: 'too many elements' });
  });
  it('長い空白の続く d を持つ path を use で 5000 回置いても、d は読み直さない (図形はこれまでどおり)', T, () => {
    const s = `<svg ${X} viewBox="0 0 1000 1000"><defs><path id="p" d="M0 0h9${' '.repeat(200_000)}"/></defs>${rep(5000, (i) => `<use xlink:href="#p" y="${i % 900}"/>`)}</svg>`;
    const { doc } = svgResult(s);
    expect(doc!.shapes.length).toBe(5000);
    expect(doc!.shapes[4999].segs).toEqual([{ op: 'M', x: 0, y: 4999 % 900 }, { op: 'L', x: 9, y: 4999 % 900 }]);
  });
});

describe('SVG: textPath の字の位置', () => {
  it('折れ線の path に沿って、字の送りの真ん中が path の上に来る (字の数 × 点の数の探し直しをしない)', T, () => {
    // 横 30 → 下 30 の折れ線。字の送りは 10 なので、3 字が横の線、3 字が縦の線に乗る
    const s = `<svg ${X} viewBox="0 0 100 100"><defs><path id="p" d="M0 0L30 0L30 30"/></defs><text font-size="10"><textPath xlink:href="#p">abcdef</textPath></text></svg>`;
    const { doc } = svgResult(s, { outline });
    const at = doc!.shapes.map((sh) => sh.segs[0]).map((g) => (g.op === 'Z' ? [] : [Math.round(g.x), Math.round(g.y)]));
    expect(at).toEqual([[0, 0], [10, 0], [20, 0], [30, 0], [30, 10], [30, 20]]);
    // 2 万の曲線の path (48 万点の折れ線) に 2 万字
    const big = `<svg ${X} viewBox="0 0 100 100"><defs><path id="p" d="M0 0${rep(20000, () => 'c1 0 2 0 3 0')}"/></defs><text font-size="1"><textPath xlink:href="#p">${'a'.repeat(20000)}</textPath></text></svg>`;
    const r = svgResult(big, { outline });
    expect(r.doc!.shapes.length).toBe(20000);
    expect(r.doc!.shapes[19999].segs[0]).toMatchObject({ op: 'M' });
    expect((r.doc!.shapes[19999].segs[0] as { x: number }).x).toBeCloseTo(19999, 6);
  });
});

describe('SVG: <style> の規則の索引', () => {
  it('5000 規則 × 5000 要素、2 万規則 × 2 万要素でも、規則を総当たりしない', T, () => {
    const s = (n: number) =>
      `<svg ${X} viewBox="0 0 100 100"><style>${rep(n, (i) => `.c${i}, rect.e${i}, #i${i}{fill:#${(i & 0xfff).toString(16).padStart(3, '0')}}`)}</style>${rep(n, (i) => `<rect class="c${i} d" width="1" height="1"/>`)}</svg>`;
    const { doc } = svgResult(s(20000));
    expect(doc!.shapes.length).toBe(20000);
    expect(doc!.shapes[0xabc].fill).toBe('#aabbcc');
    // すべての規則がすべての要素に当たる場合 (同じ選択子の規則は、まとめて引く)
    const all = `<svg ${X} viewBox="0 0 100 100"><style>${rep(20000, (i) => `.d{fill:#${(i & 0xfff).toString(16).padStart(3, '0')}}`)}</style>${rep(20000, (i) => `<rect class="c${i} d" width="1" height="1"/>`)}</svg>`;
    const r = svgResult(all);
    expect(r.doc!.shapes.length).toBe(20000);
    expect(r.doc!.shapes[7].fill).toBe('#ee11ff'); // 最後の規則 (19999 & 0xfff = 0xe1f)
  });
  it('当てる順 (詳細度・出現順) は、規則を順に重ねたときと同じ', T, () => {
    // 疑似乱数で規則と要素を作り、索引を使わない素直な重ね方 (parseCss の並びを順に当てる) と、図形の色を比べる
    let seed = 12345;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    const tags = ['rect', 'circle', '*', ''];
    const classes = ['a', 'b', 'c', 'd'];
    const ids = ['x', 'y', 'z'];
    const colors = ['#110000', '#220000', '#330000', '#440000', '#550000', '#660000', '#770000'];
    const selector = () => {
      const t = tags[rnd(tags.length)];
      const cs = rep(rnd(3), () => `.${classes[rnd(classes.length)]}`);
      const id = rnd(4) === 0 ? `#${ids[rnd(ids.length)]}` : '';
      return t + id + cs || '*';
    };
    const rules = rep(300, () => {
      const sels = Array.from({ length: 1 + rnd(2) }, selector).join(', ');
      const decls = [rnd(3) ? `fill:${colors[rnd(colors.length)]}` : '', rnd(3) === 0 ? `stroke:${colors[rnd(colors.length)]}` : '', rnd(4) === 0 ? `stroke-width:${1 + rnd(5)}` : ''].filter(Boolean).join(';');
      return `${sels}{${decls}}\n`;
    });
    const els = Array.from({ length: 400 }, () => {
      const tag = rnd(2) ? 'rect' : 'circle';
      const cls = classes.filter(() => rnd(2)).join(' ');
      const id = rnd(3) === 0 ? ids[rnd(ids.length)] : undefined;
      return { tag, cls, id };
    });
    const body = els.map((e) => `<${e.tag}${e.id ? ` id="${e.id}"` : ''}${e.cls ? ` class="${e.cls}"` : ''} ${e.tag === 'rect' ? 'width="5" height="5"' : 'r="5"'}/>`).join('');
    const { doc } = svgResult(`<svg ${X} viewBox="0 0 100 100"><style>${rules}</style>${body}</svg>`);
    const sorted = parseCss(rules);
    expect(sorted.length).toBeGreaterThan(300);
    const expected = els.map((e) => {
      const cls = new Set(e.cls.split(/\s+/).filter(Boolean));
      const out: Record<string, string> = {};
      for (const r of sorted) {
        if ((r.tag && r.tag !== e.tag) || (r.id && r.id !== e.id) || !r.classes.every((c) => cls.has(c))) continue;
        Object.assign(out, r.decls);
      }
      return { fill: out.fill ?? '#000000', stroke: out.stroke, strokeWidth: out['stroke-width'] ? Number(out['stroke-width']) : 1 };
    });
    expect(doc!.shapes.length).toBe(400);
    expect(doc!.shapes.map((sh) => ({ fill: sh.fill, stroke: sh.stroke, strokeWidth: sh.strokeWidth }))).toEqual(expected);
  });
});

describe('SVG: 深い入れ子', () => {
  it('入れ子の段を、解析せずに数える (注釈・CDATA・処理命令・DOCTYPE・引用符の中の > は数えない)', () => {
    const nest = (n: number, inner = '<rect/>') => `<svg>${'<g>'.repeat(n - 1)}${inner}${'</g>'.repeat(n - 1)}</svg>`;
    expect(svgNestTooDeep(nest(SVG_MAX_NEST))).toBe(false);
    expect(svgNestTooDeep(nest(SVG_MAX_NEST, '<g><rect/></g>'))).toBe(true);
    expect(svgNestTooDeep(nest(3), 2)).toBe(true);
    expect(svgNestTooDeep(nest(3), 3)).toBe(false);
    // 閉じた要素・空要素は積まない
    expect(svgNestTooDeep(`<svg>${'<g><rect/></g>'.repeat(1000)}</svg>`, 2)).toBe(false);
    // 注釈・CDATA・処理命令・DOCTYPE の中の < は要素でない
    expect(svgNestTooDeep(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "<g><g><g>">]><svg><!-- <g><g><g> --><style><![CDATA[ <g><g><g> ]]></style><?pi <g><g><g>?></svg>`, 2)).toBe(false);
    // 属性の値の中の > では、タグは終わらない (/> で終わる空要素)
    expect(svgNestTooDeep(`<svg>${'<g a=">" b=\'>\'/>'.repeat(10)}</svg>`, 1)).toBe(false);
    // 名前の続かない < は文字
    expect(svgNestTooDeep('<svg><text>a < b << c</text></svg>', 2)).toBe(false);
  });
  it('<g> を 10 万段重ねた SVG は、解析を呼ばずに、図形にできないものとして扱う', T, () => {
    let parsed = 0;
    let why = '';
    const text = `<svg ${X} viewBox="0 0 100 100">${'<g>'.repeat(100_000)}<rect width="5" height="5"/>${'</g>'.repeat(100_000)}</svg>`;
    const doc = parseSvg(text, (s) => (parsed++, parseXml(s)), { onUnsupported: (w) => (why = w) });
    expect({ doc, why, parsed }).toEqual({ doc: null, why: 'too deep', parsed: 0 });
  });
  it('30 段の入れ子は、これまでどおり図形にする', () => {
    const { doc } = svgResult(`<svg ${X} viewBox="0 0 100 100">${'<g>'.repeat(30)}<rect width="5" height="5"/>${'</g>'.repeat(30)}</svg>`);
    expect(doc!.shapes.length).toBe(1);
  });
});

describe('数式: 多数の子・多数の字', () => {
  let mf: MathFont;
  beforeAll(async () => {
    mf = readMathFont(fontkit.create(new Uint8Array(await mathFontBuffer())) as unknown as FkFont)!;
  });
  const math = (body: string) => new DOMParser().parseFromString(`<math xmlns="http://www.w3.org/1998/Math/MathML">${body}</math>`, 'text/xml').documentElement as unknown as MNode;
  const lay = (body: string) => layoutMathML(math(body), { font: mf, size: 10, color: '#000000' });
  it('mo の form を決めるとき、親の子の並びを mo ごとに読み直さない (<mo>(</mo><mi>x</mi> を 5000 組)', T, () => {
    const r = lay(rep(5000, () => '<mo>(</mo><mi>x</mi>'));
    expect(r.width).toBeGreaterThan(0);
    expect(r.truncated).toBeUndefined();
  });
  it('form の決め方は変えない: 並びの先頭は prefix、末尾は postfix (前後のアキが違う)', () => {
    // 3.2.4.2: 括弧は、先頭なら prefix、末尾なら postfix、間なら infix として辞書を引く
    const a = lay('<mo>(</mo><mi>x</mi><mo>)</mo>');
    const b = lay('<mi>x</mi><mo>(</mo><mi>x</mi><mo>)</mo><mi>x</mi>');
    expect(a.width).toBeGreaterThan(0);
    expect(b.width).toBeGreaterThan(a.width);
  });
  it(`字が ${MAX_MATH_GLYPHS} を超える数式は、超えた分を描かない (箱の大きさは変えない)`, T, () => {
    const big = lay(`<mn>${'7'.repeat(MAX_MATH_GLYPHS + 5000)}</mn>`);
    expect(big.truncated).toBe(true);
    const small = lay(`<mn>${'7'.repeat(100)}</mn>`);
    expect(small.truncated).toBeUndefined();
    // 箱の幅は、描かなかった字も含めて組んだ幅
    expect(big.width / small.width).toBeCloseTo((MAX_MATH_GLYPHS + 5000) / 100, 0);
    // 描いた字の数 (M の数で数える。7 の輪郭は 1 つの閉じた線)
    const ms = (r: { svg: string }) => (r.svg.match(/M/g) ?? []).length;
    expect(ms(big) / ms(small)).toBeCloseTo(MAX_MATH_GLYPHS / 100, 0);
  });
});
