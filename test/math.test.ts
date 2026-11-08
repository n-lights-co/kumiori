import { beforeAll, describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { DOMParser } from '@xmldom/xmldom';
import { readMathFont, type FkFont, type MathFont } from '../src/mathFont';
import { layoutMathML, type MNode } from '../src/mathLayout';
import { operatorCategory, operatorProps } from '../src/mathOperators';
import { mathVariantChar } from '../src/mathVariants';
import { importXslFo, type XNode } from '../src/xslfoImport';
import { mathFontBuffer } from './helpers';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as XNode;
const math = (body: string, attrs = '') => (new DOMParser().parseFromString(`<math xmlns="http://www.w3.org/1998/Math/MathML"${attrs}>${body}</math>`, 'text/xml').documentElement as unknown as MNode);

describe('演算子辞書 (MathML Core B.1)', () => {
  it('分類', () => {
    expect(operatorCategory('+', 'infix')).toBe('B');
    expect(operatorCategory('=', 'infix')).toBe('Default');
    expect(operatorCategory('→', 'infix')).toBe('A');
    expect(operatorCategory('(', 'prefix')).toBe('F');
    expect(operatorCategory(')', 'postfix')).toBe('G');
    expect(operatorCategory('∑', 'prefix')).toBe('J');
    expect(operatorCategory('∫', 'prefix')).toBe('H');
    expect(operatorCategory(',', 'infix')).toBe('M');
    expect(operatorCategory('|', 'infix')).toBe('ForceDefault');
  });
  it('form を指定していなければ、Default のとき infix・postfix・prefix の順に引き直す', () => {
    expect(operatorProps('∑', 'infix', false)).toMatchObject({ largeop: true, movablelimits: true });
    expect(operatorProps('∑', 'infix', true).largeop).toBe(false);
  });
});

describe('数学用英数字記号', () => {
  it('斜体・太字', () => {
    expect(mathVariantChar(0x61, 'italic')).toBe(0x1d44e);
    expect(mathVariantChar(0x68, 'italic')).toBe(0x210e);
    expect(mathVariantChar(0x3b8, 'italic')).toBe(0x1d703);
    expect(mathVariantChar(0x41, 'bold')).toBe(0x1d400);
    expect(mathVariantChar(0x52, 'double-struck')).toBe(0x211d);
    expect(mathVariantChar(0x31, 'italic')).toBe(0x31);
  });
});

describe('MATH 表と数式の組版', () => {
  let mf: MathFont;
  beforeAll(async () => {
    mf = readMathFont(fontkit.create(new Uint8Array(await mathFontBuffer())) as unknown as FkFont)!;
  });
  const lay = (body: string, attrs = '') => layoutMathML(math(body, attrs), { font: mf, size: 10, color: '#000000' });

  it('MATH 表を読む', () => {
    expect(mf.constants.axisHeight).toBeGreaterThan(0);
    expect(mf.constants.scriptPercentScaleDown).toBeGreaterThan(0);
    const g = mf.fk.glyphForCodePoint(0x222b).id;
    const c = mf.construction(g, true)!;
    expect(c.variants.length).toBeGreaterThan(1);
    expect(c.assembly?.parts.some((p) => p.extender)).toBe(true);
  });
  it('分数は軸の上と下に分子・分母を置き、幅は広い方 (分子・分母は添え字の大きさ)', () => {
    const one = lay('<mi>a</mi>');
    const f = lay('<mfrac><mi>a</mi><mrow><mi>b</mi><mo>+</mo><mi>c</mi></mrow></mfrac>');
    expect(f.ascent).toBeGreaterThan(one.ascent);
    expect(f.descent).toBeGreaterThan(one.descent);
    expect(f.width).toBeGreaterThan(lay('<mstyle scriptlevel="1"><mi>b</mi><mo>+</mo><mi>c</mi></mstyle>').width - 0.01);
  });
  it('mfenced の直下の mo の form は、括弧の内側の並びで決める (先頭なら prefix)', () => {
    const fenced = lay('<mfenced separators=""><mo>-</mo><mi>x</mi></mfenced>');
    const row = lay('<mrow><mo>(</mo><mrow><mo>-</mo><mi>x</mi></mrow><mo>)</mo></mrow>');
    expect(fenced.width).toBeCloseTo(row.width, 1);
  });
  it('括弧は中身の高さまで伸びる', () => {
    const small = lay('<mo>(</mo><mi>x</mi><mo>)</mo>');
    const big = lay('<mo>(</mo><mfrac><mfrac><mi>a</mi><mi>b</mi></mfrac><mi>c</mi></mfrac><mo>)</mo>');
    expect(big.ascent + big.descent).toBeGreaterThan((small.ascent + small.descent) * 1.8);
    // stretchy="false" なら伸ばさない
    const fixed = lay('<mo stretchy="false">(</mo><mfrac><mfrac><mi>a</mi><mi>b</mi></mfrac><mi>c</mi></mfrac><mo stretchy="false">)</mo>');
    expect(fixed.ascent + fixed.descent).toBeLessThan(big.ascent + big.descent);
  });
  it('別行立て (display="block") の和の記号は大きく、上下に添え字を置く', () => {
    const body = '<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>x</mi>';
    const inline = lay(body);
    const block = lay(body, ' display="block"');
    expect(block.ascent + block.descent).toBeGreaterThan((inline.ascent + inline.descent) * 1.3);
  });
  it('上付きの添え字は小さく、上に', () => {
    const base = lay('<mi>x</mi>');
    const sup = lay('<msup><mi>x</mi><mn>2</mn></msup>');
    expect(sup.ascent).toBeGreaterThan(base.ascent);
    expect(sup.width).toBeLessThan(base.width * 2.2);
  });
  it('根号は中身の上に横線を引く', () => {
    const r = lay('<msqrt><mi>x</mi></msqrt>');
    expect(r.svg).toMatch(/<path fill="#000000"/);
    expect(r.width).toBeGreaterThan(lay('<mi>x</mi>').width);
  });
  it('Content MathML を見た目の記法にして組む', () => {
    const r = lay('<apply><divide/><ci>a</ci><cn>2</cn></apply>');
    expect(r.ascent + r.descent).toBeGreaterThan(lay('<mi>a</mi>').ascent * 1.5);
  });
  it('antenna: 1 字の基では添え字を基の字の高さで上げず、根号の高さが a と b でそろう', () => {
    const sq = (v: string, compat: 'antenna' | 'spec') =>
      layoutMathML(math(`<msqrt><msup><mrow><msub><mi>${v}</mi><mn>1</mn></msub></mrow><mn>2</mn></msup></msqrt>`), { font: mf, size: 10, color: '#000000', compat });
    const a = sq('a', 'antenna');
    const b = sq('b', 'antenna');
    expect(b.ascent + b.descent).toBeCloseTo(a.ascent + a.descent, 1);
    // spec (MathML Core) では、b の上付きが上がって根号が大きくなる
    expect(sq('b', 'spec').ascent).toBeGreaterThan(sq('a', 'spec').ascent);
  });
  it('antenna: 縦線の高さに上のアクセントを含めず、ベクトルの a と b で同じ高さ', () => {
    const v = (x: string) =>
      layoutMathML(math(`<mo>|</mo><mover accent="true"><mi>${x}</mi><mo stretchy="true">→</mo></mover><mo>|</mo>`), { font: mf, size: 10, color: '#000000', compat: 'antenna' });
    // 縦線の上端 (下端) は同じ。上の高さの違いは、矢印の位置の違いだけ
    expect(v('a').descent).toBeCloseTo(v('b').descent, 2);
  });
  it('mathcolor の色で描く', () => {
    const r = layoutMathML(math('<mi mathcolor="red">x</mi>'), { font: mf, size: 10, color: '#000000', parseColor: (v) => (v === 'red' ? '#ff0000' : undefined) });
    expect(r.svg).toContain('fill="#ff0000"');
  });
  it('XSL-FO の読み込み: 数式の書体があれば、数式を SVG の画像にして、深さだけ基線より下げる', () => {
    const fo = `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>a <fo:instream-foreign-object><math xmlns="http://www.w3.org/1998/Math/MathML"><msub><mi>x</mi><mn>1</mn></msub></math></fo:instream-foreign-object></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const res = importXslFo(fo, parse, { mathFont: mf });
    const json = JSON.stringify(res.document);
    expect(json).toMatch(/"baselineShift":-[\d.]+,"children":\[\{"type":"image","src":"data:image\/svg\+xml;base64,/);
  });
});
