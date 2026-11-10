/**
 * 描くときだけに効く効果 (NC-05): CSS の transform (と translate・rotate・scale)・transform-origin・transform-box・opacity。
 *  - CSS Transforms 1 §3 (行列の作り方・組版に影響しない・包含ブロック)・§5・§6・§9・§10・§14、CSS Transforms 2 §5・§6
 *  - CSS Color 4 §3.3 (不透明度は要素の全体に掛かり、中の重なりは濃くならない)
 *  - CSS Fragmentation 3 §5.5 (効果は断片ごと)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { parseIndividualTransform, parseTransformList, parseTransformOrigin } from '../src/cssTransform';
import { transformMatrix } from '../src/paintEffect';
import { paintSheet, type Painter } from '../src/paint';
import { apply } from '../src/matrix';
import { DEFAULT_FONTS, serializeAreaTree, typesetHtml, walkAreaTree, type FontSpec } from '../src/index';
import type { Area, AreaTree } from '../src/types';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const page = (body: string, css = '') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>@page { size: 100mm 100mm; margin: 10mm } body { margin: 0; font-size: 10pt } p { margin: 0; text-indent: 0 } .b { width: 40pt; height: 20pt; background: #9cf } ${css}</style></head><body>${body}</body></html>`;
const set = (html: string) => typesetHtml(html, { name: 't.html', loadFont });
const areas = (t: AreaTree, pred: (a: Area) => boolean): Area[] => {
  const out: Area[] = [];
  walkAreaTree(t, (a) => {
    if (a.type !== 'sheet' && pred(a as Area)) out.push(a as Area);
  });
  return out;
};
// (長さは、カスケードが px にするときに小数第 4 位で丸めるので、pt では 1e-4 ほどの誤差がある)
const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 3));

/** 描く処理の呼び出しを記録する Painter */
function recorder(): { p: Painter; log: string[] } {
  const log: string[] = [];
  const p = new Proxy({} as Painter, {
    get:
      (_t, name) =>
      (...args: unknown[]) => {
        log.push(`${String(name)} ${JSON.stringify(args.map((a) => (typeof a === 'function' ? 'fn' : a)))}`);
        for (const a of args) if (typeof a === 'function') (a as () => void)();
        if (typeof name === 'string' && args.some((a) => typeof a === 'function')) log.push(`end ${name}`);
      },
  });
  return { p, log };
}

describe('transform の値を読む (cssTransform)', () => {
  it('2D の関数 (Transforms 1 §9.1): translate・scale・rotate・skew・matrix と、その並び', () => {
    expect(parseTransformList('none')).toEqual([]);
    expect(parseTransformList('translate(10px, 50%) scale(2) rotate(0.25turn) skewX(10deg) matrix(1, 2, 3, 4, 8, 16)')).toEqual([
      { fn: 'translate', x: 7.5, y: '50%' },
      { fn: 'scale', x: 2, y: 2 },
      { fn: 'rotate', deg: 90 },
      { fn: 'skew', x: 10, y: 0 },
      // matrix の e・f は CSS px (§14)。Kumiori の長さは pt
      { fn: 'matrix', m: [1, 2, 3, 4, 6, 12] },
    ]);
    // translate の 2 つ目を略すと 0、scale の 2 つ目を略すと 1 つ目と同じ、skew の 2 つ目を略すと 0 (§9.1)
    expect(parseTransformList('translate(4pt) translateX(1in) translateY(-3pt) scaleX(3) scaleY(.5) scale(2, 3) skew(10deg) skewY(5deg) skew(1deg, 2deg)')).toEqual([
      { fn: 'translate', x: 4, y: 0 },
      { fn: 'translate', x: 72, y: 0 },
      { fn: 'translate', x: 0, y: -3 },
      { fn: 'scale', x: 3, y: 1 },
      { fn: 'scale', x: 1, y: 0.5 },
      { fn: 'scale', x: 2, y: 3 },
      { fn: 'skew', x: 10, y: 0 },
      { fn: 'skew', x: 0, y: 5 },
      { fn: 'skew', x: 1, y: 2 },
    ]);
  });
  it('角度の単位 (deg・grad・rad・turn) と、単位の無い 0 (§9: <zero> は 0deg)', () => {
    const deg = (v: string) => (parseTransformList(`rotate(${v})`) as Array<{ deg: number }>)[0].deg;
    expect(deg('45deg')).toBe(45);
    expect(deg('100grad')).toBeCloseTo(90);
    expect(deg('3.14159265rad')).toBeCloseTo(180);
    expect(deg('-0.5turn')).toBe(-180);
    expect(deg('0')).toBe(0);
    expect(parseTransformList('rotate(45)')).toEqual({ miss: 'rotate()' });
  });
  it('3D の関数と、読めない引数は読まない (関数の名前を返す)。rotateZ() は 2D の回転', () => {
    for (const f of ['matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)', 'translate3d(1px, 2px, 3px)', 'translateZ(2px)', 'scale3d(1,1,2)', 'scaleZ(2)', 'rotate3d(1,1,0,45deg)', 'rotateX(10deg)', 'rotateY(10deg)', 'perspective(100px)'])
      expect(parseTransformList(`rotate(10deg) ${f}`)).toEqual({ miss: `${/^[a-z0-9]+/i.exec(f)![0].toLowerCase()}()` });
    expect(parseTransformList('rotateZ(30deg)')).toEqual([{ fn: 'rotate', deg: 30 }]);
    expect(parseTransformList('scale(1, 2, 3)')).toEqual({ miss: 'scale()' });
    expect(parseTransformList('translate(calc(50% - 10px))')).toEqual({ miss: 'translate()' });
  });
  it('translate・rotate・scale の性質 (Transforms 2 §5)。3D になる値は読まない', () => {
    expect(parseIndividualTransform('translate', 'none')).toBeUndefined();
    expect(parseIndividualTransform('translate', '10px')).toEqual({ fn: 'translate', x: 7.5, y: 0 });
    expect(parseIndividualTransform('translate', '50% 4pt 0px')).toEqual({ fn: 'translate', x: '50%', y: 4 });
    expect(parseIndividualTransform('translate', '1px 2px 3px')).toEqual({ miss: 'translate: 1px 2px 3px' });
    expect(parseIndividualTransform('rotate', '30deg')).toEqual({ fn: 'rotate', deg: 30 });
    expect(parseIndividualTransform('rotate', 'z 30deg')).toEqual({ fn: 'rotate', deg: 30 });
    expect(parseIndividualTransform('rotate', '0 0 1 30deg')).toEqual({ fn: 'rotate', deg: 30 });
    expect(parseIndividualTransform('rotate', '30deg z')).toEqual({ fn: 'rotate', deg: 30 });
    expect(parseIndividualTransform('rotate', 'x 30deg')).toEqual({ miss: 'rotate: x 30deg' });
    expect(parseIndividualTransform('rotate', '1 1 0 30deg')).toEqual({ miss: 'rotate: 1 1 0 30deg' });
    expect(parseIndividualTransform('scale', '2')).toEqual({ fn: 'scale', x: 2, y: 2 });
    expect(parseIndividualTransform('scale', '150% 0.5 1')).toEqual({ fn: 'scale', x: 1.5, y: 0.5 });
    expect(parseIndividualTransform('scale', '1 1 2')).toEqual({ miss: 'scale: 1 1 2' });
  });
  it('transform-origin (Transforms 1 §5): 1 つだけならもう一方は center、語の組は順が逆でもよい、3 つ目 (z) は使わない', () => {
    expect(parseTransformOrigin('50% 50%')).toBeUndefined();
    expect(parseTransformOrigin('center')).toBeUndefined();
    expect(parseTransformOrigin('left')).toEqual(['0%', '50%']);
    expect(parseTransformOrigin('bottom')).toEqual(['50%', '100%']);
    expect(parseTransformOrigin('10px')).toEqual([7.5, '50%']);
    expect(parseTransformOrigin('left top')).toEqual(['0%', '0%']);
    expect(parseTransformOrigin('top left')).toEqual(['0%', '0%']);
    expect(parseTransformOrigin('bottom right')).toEqual(['100%', '100%']);
    expect(parseTransformOrigin('20% 4pt 10px')).toEqual(['20%', 4]);
    expect(parseTransformOrigin('right 25%')).toEqual(['100%', '25%']);
  });
});

describe('変換の行列 (Transforms 1 §3)', () => {
  it('原点だけ移し、関数を左から掛け、原点の分を戻す (仕様の例: 100×100 の箱を、50px 50px を原点に 45 度回す)', () => {
    const m = transformMatrix({ functions: [{ fn: 'rotate', deg: 45 }], origin: [50, 50] }, 0, 0, 100, 100);
    // 原点は動かない。箱の左上は、原点の真上 (時計回りに 45 度) へ
    near(apply(m, 50, 50), [50, 50]);
    near(apply(m, 0, 0), [50, 50 - 50 * Math.SQRT2]);
  });
  it('並びは、入れ子の箱に 1 つずつ掛けたのと同じ (§10): translate → scale → rotate の順に、内側から効く', () => {
    const m = transformMatrix({ functions: [{ fn: 'translate', x: 80, y: 80 }, { fn: 'scale', x: 1.5, y: 1.5 }, { fn: 'rotate', deg: 90 }], origin: [0, 0] }, 0, 0, 100, 100);
    // (10, 0) → 回して (0, 10) → 1.5 倍で (0, 15) → 移して (80, 95)
    near(apply(m, 10, 0), [80, 95]);
  });
  it('原点の初期値は基準の箱の中央。百分率は基準の箱の大きさに対して (§5・§9)', () => {
    const m = transformMatrix({ functions: [{ fn: 'rotate', deg: 180 }] }, 10, 20, 40, 20);
    near(apply(m, 10, 20), [50, 40]);
    const t = transformMatrix({ functions: [{ fn: 'translate', x: '50%', y: '-100%' }] }, 0, 0, 40, 20);
    near(t, [1, 0, 0, 1, 20, -20]);
  });
  it('skew(α, β) は x\' = x + y·tan α、y\' = x·tan β + y (§14)', () => {
    const m = transformMatrix({ functions: [{ fn: 'skew', x: 45, y: 0 }], origin: [0, 0] }, 0, 0, 10, 10);
    near(apply(m, 0, 10), [10, 10]);
    const n = transformMatrix({ functions: [{ fn: 'skew', x: 0, y: 45 }], origin: [0, 0] }, 0, 0, 10, 10);
    near(apply(n, 10, 0), [10, 10]);
  });
});

describe('HTML の transform', () => {
  it('組版に影響しない (§3): 変換の有無で、どの Area の位置・大きさも変わらない。Area に行列が付く', async () => {
    const body = (st: string) => `<p>前</p><div class="b" style="margin-left: 30pt; ${st}">箱</div><p>後</p>`;
    const plain = await set(page(body('')));
    const turned = await set(page(body('transform: rotate(90deg)')));
    const boxes = areas(turned.areaTree, (a) => !!a.transform);
    expect(boxes.length).toBe(1);
    const b = boxes[0];
    near([b.width, b.height], [40, 20]);
    // 中央 (20, 10) を原点に時計回りに 90 度: x' = −y + 30、y' = x − 10
    near(b.transform!, [0, 1, -1, 0, 30, -10]);
    delete b.transform;
    expect(serializeAreaTree(turned.areaTree)).toBe(serializeAreaTree(plain.areaTree));
    expect(turned.pageCount).toBe(plain.pageCount);
  });
  it('百分率の translate と transform-origin・transform-box は、基準の箱の大きさで決まる (§5・§6・§9)', async () => {
    const r = await set(
      page(
        '<div class="b" style="transform: translate(50%, 100%)">a</div>' +
          '<div class="b" style="transform: rotate(90deg); transform-origin: 0 0">b</div>' +
          '<div class="b" style="padding: 5pt; border: 6pt solid #000; transform: scale(2); transform-origin: left top; transform-box: content-box">c</div>',
      ),
    );
    const [a, b, c] = areas(r.areaTree, (x) => !!x.transform);
    near(a.transform!, [1, 0, 0, 1, 20, 20]);
    near(b.transform!, [0, 1, -1, 0, 0, 0]);
    // 内容の箱の左上 (11, 11) を原点に 2 倍
    near(c.transform!, [2, 0, 0, 2, -11, -11]);
  });
  it('translate・rotate・scale の性質は、transform の関数より先に、この順で掛ける (Transforms 2 §6)', async () => {
    const r = await set(page('<div class="b" style="transform-origin: 0 0; transform: translate(1pt, 0); scale: 2; rotate: 90deg; translate: 10pt 20pt">a</div>'));
    const [a] = areas(r.areaTree, (x) => !!x.transform);
    // translate(10, 20)·rotate(90)·scale(2)·translate(1, 0): (0, 0) → (1, 0) → (2, 0) → (0, 2) → (10, 22)
    near(apply(a.transform!, 0, 0), [10, 22]);
    near(a.transform!.slice(0, 4), [0, 2, -2, 0]);
  });
  it('置換要素でない行内の箱には効かない (§2)。画像・inline-block・表・セル・行・回り込み・flex の項目・縦書きの箱には効く', async () => {
    const r = await set(
      page(
        '<p><span style="transform: rotate(10deg)">span</span> <span id="ib" style="display: inline-block; transform: rotate(10deg)">ib</span></p>' +
          '<div class="b" style="float: right; transform: rotate(10deg)">f</div>' +
          '<table style="transform: rotate(10deg)"><tr style="transform: rotate(10deg)"><td style="transform: rotate(10deg)">c</td></tr></table>' +
          '<div style="display: flex"><div class="b" style="transform: rotate(10deg)">x</div></div>' +
          '<div class="b" style="writing-mode: vertical-rl; transform: rotate(10deg)">縦</div>' +
          '<ul><li style="transform: rotate(10deg)">項目</li></ul>',
      ),
    );
    const types = areas(r.areaTree, (x) => !!x.transform).map((a) => a.type);
    expect(types.sort()).toEqual(['block', 'block', 'block', 'block', 'table', 'table-cell', 'table-row', 'table-row']);
    expect(r.warnings.filter((w) => /未対応|知らない/.test(w))).toEqual([]);
    expect(serializeAreaTree(r.areaTree)).not.toContain('__paint');
  });
  it('ページで分かれた箱は、断片ごとに、その断片の箱を基準に変換する (Fragmentation 3 §5.5)', async () => {
    const r = await set(page('<div style="height: 180pt"></div><div class="b" style="height: 80pt; transform: rotate(180deg)"><p>一</p><p>二</p><p>三</p><p>四</p><p>五</p></div>'));
    expect(r.pageCount).toBe(2);
    const frags = areas(r.areaTree, (x) => !!x.transform);
    expect(frags.length).toBe(2);
    for (const f of frags) near(f.transform!, [-1, 0, 0, -1, f.width, f.height]);
    expect(frags[0].height).not.toBeCloseTo(frags[1].height, 3);
  });
  it('変換の付いた箱は、中の絶対配置の箱の基準になる (§3: containing block for all descendants)', async () => {
    const child = '<div id="c" style="position: absolute; right: 0; bottom: 0; width: 10pt; height: 5pt; background: #f90"></div>';
    const tr = await set(page(`<div class="b" style="margin: 30pt; transform: rotate(10deg)">${child}</div>`));
    const rel = await set(page(`<div class="b" style="margin: 30pt; position: relative">${child}</div>`));
    const pos = (t: AreaTree) => areas(t, (x) => x.backgroundColor === '#ff9900').map((x) => [x.x, x.y, x.width, x.height]);
    expect(pos(tr.areaTree)).toEqual(pos(rel.areaTree));
    near(pos(tr.areaTree)[0], [30, 15, 10, 5]);
  });
  it('3D の変換は掛けず、未対応の値として知らせる。効果を使わない文書の Area には欄が付かない', async () => {
    const r = await set(page('<div class="b" style="transform: rotateX(45deg)">a</div><div class="b" style="rotate: x 10deg">b</div><div class="b" style="transform: perspective(10px) translate(1px)">c</div>'));
    expect(areas(r.areaTree, (x) => !!x.transform)).toEqual([]);
    expect(r.warnings.find((w) => w.startsWith('未対応の CSS を無視しました: '))).toBe('未対応の CSS を無視しました: rotate: x 10deg、transform: perspective()、transform: rotatex()');
    const none = await set(page('<div class="b" style="transform: none; opacity: 1; translate: none">a</div>'));
    expect(serializeAreaTree(none.areaTree)).not.toMatch(/"transform"|"opacity"|__paint/);
    expect(none.warnings.filter((w) => /未対応|知らない/.test(w))).toEqual([]);
  });
});

describe('HTML の opacity (Color 4 §3.3)', () => {
  it('箱の Area に不透明度が付く (百分率・範囲の外の値は [0, 1] に丸める)。組版は変わらない', async () => {
    const body = (a: string, b: string, c: string) => `<div class="b" style="${a}"><div class="b" style="background: #f00">中</div></div><div class="b" style="${b}">b</div><div class="b" style="${c}">c</div>`;
    const plain = await set(page(body('', '', '')));
    const r = await set(page(body('opacity: .5', 'opacity: 25%', 'opacity: -3')));
    const got = areas(r.areaTree, (x) => x.opacity !== undefined);
    expect(got.map((x) => [x.type, x.opacity])).toEqual([['block', 0.5], ['block', 0.25], ['block', 0]]);
    for (const a of got) delete a.opacity;
    expect(serializeAreaTree(r.areaTree)).toBe(serializeAreaTree(plain.areaTree));
  });
  it('行内の箱: 枠・背景と中身 (入れ子の span も) を 1 つの inline の Area にまとめて、そこに付ける', async () => {
    const r = await set(page('<p>前 <span style="opacity: .4; border: 1pt solid #f00; background: #ff0">薄い <b>太字</b> 字</span> 後</p>'));
    const got = areas(r.areaTree, (x) => x.opacity !== undefined);
    expect(got.length).toBe(1);
    expect(got[0].type).toBe('inline');
    const inside: Area[] = [];
    const walk = (a: Area) => {
      inside.push(a);
      for (const k of (a as { children?: Area[] }).children ?? []) walk(k);
    };
    walk(got[0]);
    // 枠 (罫線)・背景・字のすべてが、まとめた Area の中にある
    expect(inside.some((a) => a.border.top?.color === '#ff0000')).toBe(true);
    expect(inside.some((a) => a.backgroundColor === '#ffff00')).toBe(true);
    expect(inside.filter((a) => a.type === 'glyph').map((a) => (a as { text: string }).text).join('')).toBe('薄い 太字 字');
    // まとめた Area の外に、薄くする字・枠は残らない
    const outside = areas(r.areaTree, (x) => x.type === 'glyph' && !inside.includes(x)).map((a) => (a as unknown as { text: string }).text).join('');
    expect(outside).toContain('前');
    expect(outside).not.toContain('薄');
    expect(serializeAreaTree(r.areaTree)).not.toContain('__paint');
  });
  it('画像・回り込み・表のセル・リストの項目にも付く。入れ子の不透明度は、それぞれの Area に付く', async () => {
    const r = await set(
      page(
        '<div class="b" style="float: right; opacity: .5">f</div><table><tr><td style="opacity: .5">c</td></tr></table><ul><li style="opacity: .5">項目</li></ul>' +
          '<div class="b" style="opacity: .5"><div class="b" style="opacity: .5">入れ子</div></div>',
      ),
    );
    expect(areas(r.areaTree, (x) => x.opacity !== undefined).map((x) => [x.type, x.opacity]).sort()).toEqual([['block', 0.5], ['block', 0.5], ['block', 0.5], ['table-cell', 0.5], ['table-row', 0.5]]);
  });
});

describe('::before・::after と、箱を作らない要素', () => {
  it('::before・::after の transform・opacity も効く (行内の ::before は opacity だけ)', async () => {
    const r = await set(
      page(
        '<p class="a">a</p><p class="k">k</p><div class="d">d</div>',
        '.a::before { content: "前置"; opacity: .3; transform: rotate(10deg) } .k::before { content: "塊"; display: block; width: 30pt; transform: rotate(180deg) }' +
          ' .d { position: relative; height: 30pt } .d::after { content: "絶"; position: absolute; right: 0; top: 0; opacity: .5; transform: scale(2) }',
      ),
    );
    const got = areas(r.areaTree, (x) => !!x.transform || x.opacity !== undefined).map((x) => [x.type, x.opacity, x.transform?.slice(0, 4).map((v) => Math.round(v))]);
    expect(got).toEqual([
      ['inline', 0.3, undefined],
      ['block', undefined, [-1, 0, 0, -1]],
      ['block', 0.5, [2, 0, 0, 2]],
    ]);
    expect(r.warnings.filter((w) => /未対応|知らない/.test(w))).toEqual([]);
  });
  it('html・body と、表の行グループの transform・opacity は掛けず、未対応として知らせる', async () => {
    const r = await set(page('<table><tbody style="opacity: .5"><tr><td>c</td></tr></tbody></table>', 'body { opacity: .9 } html { transform: scale(.5) }'));
    expect(areas(r.areaTree, (x) => !!x.transform || x.opacity !== undefined)).toEqual([]);
    expect(r.warnings.find((w) => w.startsWith('未対応の CSS を無視しました: '))).toBe('未対応の CSS を無視しました: transform・opacity (html・body)、transform・opacity (thead・tbody・tfoot)');
  });
});

describe('描き方 (paint)', () => {
  it('変換 → 不透明度のグループ → 箱と中身の順に描く。変換は、箱の左上を原点にした行列を Sheet の座標に直して渡す', async () => {
    const r = await set(page('<div class="b" style="margin: 10pt 0 0 30pt; opacity: .5; transform: scale(2); transform-origin: 0 0">a</div>'));
    const { p, log } = recorder();
    paintSheet(r.areaTree.sheets[0], p);
    const k = log.findIndex((l) => l.startsWith('transform '));
    // 箱の左上は、用紙の (10mm + 30pt, 10mm + 10pt)
    const X = (10 * 72) / 25.4 + 30;
    const Y = (10 * 72) / 25.4 + 10;
    near(JSON.parse(log[k].slice('transform '.length))[0], [2, 0, 0, 2, -X, -Y]);
    expect(log[k + 1]).toBe('group [0.5,"fn"]');
    expect(log[k + 2]).toMatch(/^fillRect /);
    const end = log.indexOf('end group');
    expect(log[end + 1]).toBe('end transform');
    expect(log.slice(k + 2, end).some((l) => l.startsWith('drawGlyph '))).toBe(true);
  });
  it('逆行列の無い変換 (scale(0)) の箱と、不透明度 0 の箱は描かない (Transforms 1 §10)', async () => {
    const r = await set(page('<div class="b" style="transform: scale(0)">零</div><div class="b" style="opacity: 0">透</div><p>見</p>'));
    const { p, log } = recorder();
    paintSheet(r.areaTree.sheets[0], p);
    const texts = log.filter((l) => l.startsWith('drawGlyph ')).map((l) => JSON.parse(l.slice('drawGlyph '.length))[0].text);
    expect(texts).toContain('見');
    expect(texts).not.toContain('零');
    expect(texts).not.toContain('透');
  });
});

describe('PDF', () => {
  const streamText = (s: PDFRawStream) => new TextDecoder().decode(decodePDFRawStream(s).decode());
  it('不透明度は、透明のグループの Form XObject を、ExtGState の ca・CA を掛けて置く。中の重なりは Form の中', async () => {
    const r = await set(page('<div style="opacity: .5"><div class="b" style="background: #00f"></div><div class="b" style="margin-top: -10pt; background: #f00">重</div></div>'));
    const pdf = await PDFDocument.load(await r.toPdf());
    const pg = pdf.getPages()[0];
    const res = pg.node.Resources()!;
    const xo = res.lookup(PDFName.of('XObject'), PDFDict);
    const forms = xo.entries().map(([, v]) => pdf.context.lookup(v) as PDFRawStream).filter((s) => String(s.dict.get(PDFName.of('Subtype'))) === '/Form');
    expect(forms.length).toBe(1);
    const group = forms[0].dict.lookup(PDFName.of('Group'), PDFDict);
    expect(String(group.get(PDFName.of('S')))).toBe('/Transparency');
    // 2 つの箱の塗りと字は Form の中 (ページの内容には、Form を置く命令だけ)
    const body = streamText(forms[0]);
    expect(body.match(/\bf\b/g)!.length).toBeGreaterThanOrEqual(2);
    expect(body).toMatch(/BT[\s\S]*ET/);
    const gs = res.lookup(PDFName.of('ExtGState'), PDFDict);
    const states = gs.entries().map(([, v]) => pdf.context.lookup(v) as PDFDict);
    expect(states.some((d) => String(d.get(PDFName.of('ca'))) === '0.5' && String(d.get(PDFName.of('CA'))) === '0.5')).toBe(true);
    const content = pg.node.Contents()!;
    const text = 'asArray' in content ? (content as unknown as { asArray(): unknown[] }).asArray().map((ref) => streamText(pdf.context.lookup(ref as never) as PDFRawStream)).join('\n') : streamText(content as unknown as PDFRawStream);
    expect(text).toMatch(/\/KmA[\w-]+ gs\s+\/KmG[\w-]* Do/);
  });
  it('変換した箱の中のリンクの矩形は、変換した後の外接矩形。字は変換 (cm) の中に書く', async () => {
    const r = await set(page('<div class="b" style="margin: 30pt; transform: rotate(90deg)"><a href="https://example.com/" style="display: block; width: 40pt; height: 20pt">L</a></div>'));
    const pdf = await PDFDocument.load(await r.toPdf());
    const pg = pdf.getPages()[0];
    const annots = pg.node.Annots()!.asArray().map((ref) => pdf.context.lookup(ref) as PDFDict);
    const link = annots.find((d) => String(d.get(PDFName.of('Subtype'))) === '/Link')!;
    const rect = (link.lookup(PDFName.of('Rect')) as unknown as { asArray(): Array<{ asNumber(): number }> }).asArray().map((n) => n.asNumber());
    // 箱 (40×20) は、中央のまわりに 90 度回って 20×40 になる。用紙の高さは 100mm
    const M = (10 * 72) / 25.4;
    const H = (100 * 72) / 25.4;
    const cx = M + 30 + 20;
    const cy = M + 30 + 10;
    near(rect, [cx - 10, H - (cy + 20), cx + 10, H - (cy - 20)]);
    const content = pg.node.Contents()!;
    const text = 'asArray' in content ? (content as unknown as { asArray(): unknown[] }).asArray().map((ref) => streamText(pdf.context.lookup(ref as never) as PDFRawStream)).join('\n') : streamText(content as unknown as PDFRawStream);
    // 時計回りの 90 度は、PDF の座標 (y が上向き) では [0 −1 1 0 …] の cm
    expect(text).toMatch(/\n0 -1 1 0 [-\d.]+ [-\d.]+ cm\n[\s\S]*BT[\s\S]*ET/);
  });
});
