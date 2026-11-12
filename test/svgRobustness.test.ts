import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseCss, parsePathData, parseSvg } from '../src/svg';

/**
 * SVG の読み取り が、細工した小さな入力で、止まらない・落ちない・メモリを使い切らない。
 * 止まらないことは、結果と vitest の制限時間で確かめる (時間の差は測らない)
 */

/** 止まる入力のテストの制限時間 (直す前は、どれも分の単位か、プロセスが落ちる) */
const T = { timeout: 30_000 };

const parseXml = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml') as never;
const svgDoc = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`;
/** parseSvg の結果と、図形にできなかった理由 */
const svgResult = (text: string) => {
  let why = '';
  const doc = parseSvg(text, parseXml, { onUnsupported: (w) => (why = w) });
  return { doc, why };
};

describe('SVG: 細工した入力 (IMG-01・IMG-03・IMG-08)', () => {
  it('path の Z の後に数が続くと構文エラー (closepath は引数を取らない: SVG 2 §9.3.4)。止まらずに null を返す', T, () => {
    expect(parsePathData('M0 0Z 1')).toBeNull();
    expect(parsePathData('M0 0z1 2 3 4')).toBeNull();
    expect(parsePathData('M0 0 L5 5 z,7')).toBeNull();
    // Z の後に命令が続くもの・Z で終わるものは、これまでどおり
    expect(parsePathData('M0 0Z')).toEqual([{ op: 'M', x: 0, y: 0 }, { op: 'Z' }]);
    expect(parsePathData('M1 2 L3 4 z m1 1 l1 0 Z')).toEqual([
      { op: 'M', x: 1, y: 2 },
      { op: 'L', x: 3, y: 4 },
      { op: 'Z' },
      { op: 'M', x: 2, y: 3 },
      { op: 'L', x: 3, y: 3 },
      { op: 'Z' },
    ]);
    // 文書としては、ほかの path の誤りと同じく、図形にできないものとして扱う
    expect(svgResult(svgDoc('<path d="M0 0Z 1"/>'))).toEqual({ doc: null, why: 'path data' });
  });

  /** use を B 個ずつ L 段重ねた SVG (図形は B^L 個になる) */
  const useTower = (B: number, L: number) => {
    let s = '<defs><g id="a0"><rect width="1" height="1"/></g>';
    for (let k = 1; k <= L; k++) s += `<g id="a${k}">${`<use href="#a${k - 1}"/>`.repeat(B)}</g>`;
    return svgDoc(`${s}</defs><use href="#a${L}"/>`);
  };
  it('use を重ねて図形が膨らむ SVG は、上限で打ち切って、図形にできないものとして扱う', T, () => {
    // 10^6 個の図形 (1.3KB の SVG)
    // (先に、参照で増える線分の上限 (svg.ts の EXPANDED_SEGS_BASE) に届く)
    expect(svgResult(useTower(10, 6))).toEqual({ doc: null, why: 'too many path segments' });
    // 2^25 個 (深さは 32 段より浅い)
    expect(svgResult(useTower(2, 25)).doc).toBeNull();
    // ふつうの大きさの重ね方 (10^4 個) は、これまでどおり図形にする
    expect(svgResult(useTower(10, 4)).doc?.shapes).toHaveLength(10_000);
  });
  it('clipPath の中の use の重なりも、同じ上限で打ち切る', T, () => {
    let s = '<defs><g id="c0"><rect width="1" height="1"/></g>';
    for (let k = 1; k <= 4; k++) s += `<g id="c${k}">${`<use href="#c${k - 1}"/>`.repeat(40)}</g>`;
    s += '<clipPath id="cp"><use href="#c4"/></clipPath></defs><rect width="5" height="5" clip-path="url(#cp)"/>';
    expect(svgResult(svgDoc(s))).toEqual({ doc: null, why: 'too many elements' });
  });
  it('中身が自分自身 (または互い) で塗られている pattern は、入れ子の上限で打ち切る (呼び出しの深さを使い切らない)', T, () => {
    const self = '<defs><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="url(#p)"/></pattern></defs><rect width="5" height="5" fill="url(#p)"/>';
    expect(svgResult(svgDoc(self))).toEqual({ doc: null, why: 'too deep' });
    const pair =
      '<defs><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="url(#q)"/></pattern>' +
      '<pattern id="q" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="url(#p)"/></pattern></defs><rect width="5" height="5" fill="url(#p)"/>';
    expect(svgResult(svgDoc(pair))).toEqual({ doc: null, why: 'too deep' });
    // ふつうの pattern は、これまでどおり
    const plain = '<defs><pattern id="p" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="#f00"/></pattern></defs><rect width="5" height="5" fill="url(#p)"/>';
    expect(svgResult(svgDoc(plain)).doc?.shapes[0].fillPattern?.shapes).toHaveLength(1);
  });

  it('<style> の規則を 1 回の走査で切り出す: 結果は正規表現の版と同じ', () => {
    const rule = (r: ReturnType<typeof parseCss>[number]) => [r.tag, r.id, r.classes, r.decls];
    expect(parseCss('/* 注釈 */ rect , .a.b { fill : red ; stroke:#000 !important }\n#x{opacity:.5}').map(rule)).toEqual([
      ['rect', undefined, [], { fill: 'red', stroke: '#000' }],
      [undefined, undefined, ['a', 'b'], { fill: 'red', stroke: '#000' }],
      [undefined, 'x', [], { opacity: '.5' }],
    ]);
    // 読み飛ばすもの: CDATA の印・@font-face・@import・@charset・@namespace
    expect(parseCss('<![CDATA[ @charset "utf-8"; @import url(a.css); @font-face { font-family: F; src: url(f.woff) } @namespace svg url(x); g{fill:blue} ]]>').map(rule)).toEqual([['g', undefined, [], { fill: 'blue' }]]);
    // 終わりの無い注釈・; の無い @import は残るので、規則の一部として読まれる (選択子として扱えなければ誤り)
    expect(() => parseCss('@import url(a.css) g{fill:blue}')).toThrow('css selector');
    expect(() => parseCss('g{fill:blue} /* 終わらない')).toThrow('css');
    // 入れ子 (@media)・選択子の無い { }・閉じない { }・余った } は扱えない
    for (const bad of ['@media print { g { fill: red } }', '{fill:red}', 'g{fill:red', 'g{fill:red}}', 'g{fill:red}{}', 'g']) expect(() => parseCss(bad), bad).toThrow('css');
    expect(parseCss('  \n ')).toEqual([]);
    expect(parseCss('g{}').map(rule)).toEqual([['g', undefined, [], {}]]);
  });
  it('<style>: { の無い長い文・終わりの無い注釈や @import の並びで、長さの 2 乗の手間にならない', T, () => {
    expect(() => parseCss('a'.repeat(400_000))).toThrow('css');
    expect(() => parseCss('/*'.repeat(200_000))).toThrow('css');
    expect(() => parseCss('@import x '.repeat(50_000))).toThrow('css');
    expect(() => parseCss(`${'@import x '.repeat(50_000)}{`)).toThrow('css');
  });
});
