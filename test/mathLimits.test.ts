/**
 * 数式 (MathML) の、止まる・落ちる入力の扱い:
 *  - scriptlevel の極端な値で、字の大きさが 0・Infinity・NaN にならない (MathML Core 4.5 The math-depth property)
 *  - 長い字の並び・多数の子・深い入れ子で、RangeError (引数の数・呼び出しの深さ) にならない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { DOMParser } from '@xmldom/xmldom';
import { readMathFont, type FkFont, type MathFont } from '../src/mathFont';
import { layoutMathML, type MNode } from '../src/mathLayout';
import { importXslFo, type XNode } from '../src/xslfoImport';
import { mathFontBuffer } from './helpers';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as XNode;
const math = (body: string, attrs = '') => new DOMParser().parseFromString(`<math xmlns="http://www.w3.org/1998/Math/MathML"${attrs}>${body}</math>`, 'text/xml').documentElement as unknown as MNode;
const nest = (open: string, close: string, n: number, inner: string) => open.repeat(n) + inner + close.repeat(n);
const foDoc = (flow: string) =>
  `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
const foMath = (body: string) => foDoc(`<fo:block><fo:instream-foreign-object><math xmlns="http://www.w3.org/1998/Math/MathML">${body}</math></fo:instream-foreign-object></fo:block>`);

let mf: MathFont;
beforeAll(async () => {
  mf = readMathFont(fontkit.create(new Uint8Array(await mathFontBuffer())) as unknown as FkFont)!;
});
const lay = (body: string) => layoutMathML(math(body), { font: mf, size: 10, color: '#000000' });
const finite = (r: { width: number; ascent: number; descent: number }) => {
  expect(Number.isFinite(r.width)).toBe(true);
  expect(Number.isFinite(r.ascent)).toBe(true);
  expect(Number.isFinite(r.descent)).toBe(true);
};

describe('数式: scriptlevel の極端な値', () => {
  const table = '<mtable frame="dashed" rowlines="dashed" columnlines="dashed"><mtr><mtd><mi>x</mi></mtd><mtd><mi>y</mi></mtd></mtr><mtr><mtd><mi>z</mi></mtd><mtd><mi>w</mi></mtd></mtr></mtable>';
  // 大きさによらない長さ (pt) の中身があると、線の太さ (字の大きさに比例) に比べて、線が極端に長くなる
  const fixed = '<mtable frame="dashed" rowlines="dashed" columnlines="dashed"><mtr><mtd><mspace width="20pt" height="10pt"/></mtd><mtd><mspace width="20pt" height="10pt"/></mtd></mtr><mtr><mtd><mi>z</mi></mtd><mtd><mi>w</mi></mtd></mtr></mtable>';
  it('scriptlevel="3000": 字の大きさは 0 にならず (深さは上限まで)、破線の表も組める', { timeout: 20000 }, () => {
    const r = lay(`<mstyle scriptlevel="3000">${table}</mstyle>`);
    finite(r);
    expect(r.svg.length).toBeLessThan(200000);
    // 破線の切れ端が多すぎる線は実線にする (切れ端を無数に作らない)
    const f = lay(`<mstyle scriptlevel="3000">${fixed}</mstyle>`);
    finite(f);
    expect(f.width).toBeGreaterThan(40);
    expect(f.svg.length).toBeLessThan(200000);
    // 深さ 3000 は上限 (100) と同じ結果
    expect(lay(`<mstyle scriptlevel="100">${fixed}</mstyle>`).svg).toBe(f.svg);
  });
  it('ふつうの大きさの破線の表は、破線のまま', () => {
    const d = lay(table);
    const s = lay(table.replace(/dashed/g, 'solid'));
    expect(d.width).toBeCloseTo(s.width, 6);
    // 破線は、実線より線の切れ端 (四角) が多い
    expect(d.svg.split('Z').length).toBeGreaterThan(s.svg.split('Z').length + 4);
  });
  it('scriptlevel="-5000": 字の大きさは Infinity にならず、幅は NaN にならない', { timeout: 20000 }, () => {
    const r = lay(`<mstyle scriptlevel="-5000">${table}</mstyle>`);
    finite(r);
    expect(r.svg).not.toContain('NaN');
    expect(r.svg).not.toContain('Infinity');
    expect(r.svg.length).toBeLessThan(200000);
  });
  it('scriptlevel を上げてから戻すと、元の大きさに戻る (上限の中)', () => {
    const plain = lay('<mi>x</mi>');
    const back = lay('<mstyle scriptlevel="5"><mstyle scriptlevel="0"><mi>x</mi></mstyle></mstyle>');
    expect(back.width).toBeCloseTo(plain.width, 6);
    // 2 段までは書体の値 (scriptPercentScaleDown・scriptScriptPercentScaleDown) のまま
    const s2 = lay('<mstyle scriptlevel="2"><mi>x</mi></mstyle>');
    expect(s2.width / plain.width).toBeCloseTo(mf.constants.scriptScriptPercentScaleDown / 100, 3);
  });
  it('桁の多い scriptlevel・後備 (数式の書体なし) でも落ちない', { timeout: 20000 }, () => {
    finite(lay(`<mstyle scriptlevel="99999999999999999999999">${table}</mstyle>`));
    finite(lay(`<mstyle scriptlevel="+99999999999999999999999"><mstyle scriptlevel="-99999999999999999999999">${table}</mstyle></mstyle>`));
  });
});

describe('数式: 長い字の並び・多数の子・深い入れ子', () => {
  it('長い mtext (20 万字)', { timeout: 60000 }, () => {
    const r = lay(`<mtext>${'-'.repeat(200000)}</mtext>`);
    finite(r);
    expect(r.width).toBeGreaterThan(1000);
  });
  it('多数の子 (15 万個の mrow・mspace)', { timeout: 60000 }, () => {
    finite(lay(`<mrow>${'<mrow/>'.repeat(150000)}</mrow>`));
    const r = lay(`<mrow><mo>(</mo>${'<mspace width="1pt"/>'.repeat(150000)}<mo>)</mo></mrow>`);
    finite(r);
    expect(r.width).toBeGreaterThan(150000);
  });
  it('多数の子 (表の行・列、mstack の行)', { timeout: 60000 }, () => {
    finite(lay(`<mtable>${'<mtr><mtd/></mtr>'.repeat(130000)}</mtable>`));
    finite(lay(`<mtable><mtr>${'<mtd/>'.repeat(130000)}</mtr></mtable>`));
    finite(lay(`<mstack>${'<none/>'.repeat(130000)}</mstack>`));
    finite(lay(`<mstack><msrow>${'<none/>'.repeat(130000)}</msrow></mstack>`));
  });
  it('深い入れ子 (apply・msgroup・msrow・mrow の 3000 段) は、深すぎる所を空にして組む', { timeout: 60000 }, () => {
    finite(lay(nest('<apply><plus/><ci>a</ci>', '</apply>', 3000, '<ci>x</ci>')));
    finite(lay(nest('<apply><sin/>', '</apply>', 3000, '<ci>x</ci>')));
    finite(lay(nest('<lambda>', '</lambda>', 3000, '<ci>x</ci>')));
    finite(lay(`<mstack>${nest('<msgroup>', '</msgroup>', 3000, '<mn>1</mn>')}</mstack>`));
    finite(lay(`<mstack>${nest('<msrow>', '</msrow>', 3000, '<mn>1</mn>')}</mstack>`));
    finite(lay(nest('<mrow>', '</mrow>', 3000, '<mi>x</mi>')));
  });
  it('浅い入れ子の Content MathML・mstack は、これまでどおり組む', () => {
    const a = lay(nest('<apply><plus/><ci>a</ci>', '</apply>', 20, '<ci>x</ci>'));
    // a + (a + … x): 21 個の字と 20 個の +
    expect(a.width).toBeGreaterThan(lay('<mi>a</mi>').width * 20);
    const g = lay(`<mstack>${nest('<msgroup>', '</msgroup>', 20, '<mn>12</mn>')}</mstack>`);
    expect(g.width).toBeCloseTo(lay('<mstack><mn>12</mn></mstack>').width, 6);
  });
});

describe('数式の後備 (数式用の書体なし)・fo:block の深い入れ子', () => {
  it('後備: 深い mrow (3000 段)・多数の子・極端な scriptlevel で落ちない', { timeout: 60000 }, () => {
    for (const body of [
      nest('<mrow>', '</mrow>', 3000, '<mi>x</mi>'),
      nest('<apply><plus/><ci>a</ci>', '</apply>', 3000, '<ci>x</ci>'),
      `<mrow><mo>(</mo>${'<mspace/>'.repeat(150000)}<mo>)</mo></mrow>`,
      '<mstyle scriptlevel="3000"><mtable frame="dashed"><mtr><mtd><mi>x</mi></mtd></mtr></mtable></mstyle>',
    ]) {
      const r = importXslFo(foMath(body), parse, {});
      expect(r.document.sequences).toHaveLength(1);
    }
  });
  it('数式の書体あり: 極端な scriptlevel でも、画像の幅・高さは数になる (NaN にならない)', { timeout: 20000 }, () => {
    for (const sl of ['3000', '-5000']) {
      const r = importXslFo(foMath(`<mstyle scriptlevel="${sl}"><mtable frame="dashed"><mtr><mtd><mi>x</mi></mtd></mtr></mtable></mstyle>`), parse, { mathFont: mf });
      const imgs: Array<{ width?: number; height?: number }> = [];
      JSON.stringify(r.document, (_k, v) => {
        if (v && typeof v === 'object' && (v as { type?: string }).type === 'image') imgs.push(v as { width?: number; height?: number });
        return v as unknown;
      });
      expect(imgs).toHaveLength(1);
      expect(Number.isFinite(imgs[0].width)).toBe(true);
      expect(Number.isFinite(imgs[0].height)).toBe(true);
    }
  });
  it('後備: 浅い入れ子の mrow は、これまでどおり中身を持つ', () => {
    const r = importXslFo(foMath(nest('<mrow>', '</mrow>', 20, '<mi>x</mi>')), parse, {});
    expect(JSON.stringify(r.document.sequences[0].flow)).toContain('"x"');
  });
  it('fo:block の深い入れ子 (5000 段) は、RangeError でなく、分かる文の誤りになる', { timeout: 60000 }, () => {
    const xml = foDoc(nest('<fo:block>', '</fo:block>', 5000, 'x'));
    let err: unknown;
    try {
      importXslFo(xml, parse, {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RangeError);
    expect((err as Error).message).toMatch(/入れ子|nest/);
  });
  it('fo:block のふつうの深さの入れ子 (100 段) は読める', () => {
    const r = importXslFo(foDoc(nest('<fo:block>', '</fo:block>', 100, 'x')), parse, {});
    expect(JSON.stringify(r.document.sequences[0].flow)).toContain('"x"');
  });
});
