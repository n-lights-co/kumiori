/**
 * 深い入れ子の値・文書で、呼び出しの深さを使い切って (RangeError) 文書の全体が組めなくならないこと:
 * calc( の 5,000 段の入れ子 (CSS・XSL-FO・SVG。cssCascade.ts の calcPx) と、4,000 段の入れ子の XHTML (xhtml.ts の書き直し)
 */
import { describe, expect, it } from 'vitest';
import { typeset } from '../src/api';
import { lengthPx } from '../src/cssCascade';
import { loadCachedFont } from './helpers';

/** 組めれば 'ok'、投げたら誤りの文と呼び出しの並びの頭 */
const run = (text: string, o = {}) =>
  typeset(text, { loadFont: loadCachedFont, ...o }).then(
    () => 'ok',
    (e) => `${String(e)}\n${(e as Error).stack?.split('\n').slice(0, 8).join('\n')}`,
  );
const nestedCalc = (n: number) => 'calc('.repeat(n) + '1px' + ')'.repeat(n);
const nestedParens = (n: number) => 'calc(' + '('.repeat(n) + '1px' + ')'.repeat(n) + ')';
const FO = (attrs: string) =>
  `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block ${attrs}>x</fo:block></fo:flow></fo:page-sequence></fo:root>`;

describe('深い入れ子', () => {
  it('calc() の入れ子の深さの上限: 浅いものは今までどおり読み、深すぎるものは読めない値', () => {
    const ctx = { fs: 16, rootFs: 16, vw: 800, vh: 600 };
    expect(lengthPx(nestedCalc(3), ctx)).toBe(1);
    expect(lengthPx(nestedParens(60), ctx)).toBe(1);
    expect(lengthPx(nestedCalc(5000), ctx)).toBeUndefined();
    expect(lengthPx(nestedParens(5000), ctx)).toBeUndefined();
  });
  it('CSS の calc( の 5,000 段の入れ子は、読めない値として組む (前は RangeError)', async () => {
    expect(await run(`<style>p{width:${nestedCalc(5000)};margin-left:${nestedParens(5000)}}</style><p>x</p>`)).toBe('ok');
  }, 60_000);
  it('XSL-FO の長さの calc( の深い入れ子', async () => {
    expect(await run(FO(`start-indent="${nestedParens(5000)}" space-before="${nestedCalc(5000)}"`))).toBe('ok');
  }, 60_000);
  it('SVG の属性・style の calc( の深い入れ子 (前は RangeError)', async () => {
    expect(await run(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="${nestedParens(5000)}" height="5" style="stroke-width:${nestedParens(5000)}"/></svg>`)).toBe('ok');
  }, 60_000);
  it('4,000 段の入れ子の XHTML (前は RangeError)', async () => {
    const d = '<div>'.repeat(4000) + 'x' + '</div>'.repeat(4000);
    expect(await run(`<html xmlns="http://www.w3.org/1999/xhtml"><body>${d}</body></html>`, { kind: 'xhtml' })).toBe('ok');
  }, 60_000);
});
