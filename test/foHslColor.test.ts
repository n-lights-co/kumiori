/**
 * NF-19 XSL-FO の hsl()・hsla() (アンテナハウスの拡張の色の関数。XSL 1.1 §5.10.2 に無い)。互換の指定 (--compat antenna) のときだけ読み、
 * 仕様モードでは無効の値として警告に出す (標準の属性に書いた拡張の値)。読み方はアンテナハウスの公開の説明 (サンプル FO 集の color-hsl-1) のとおり:
 * 色相は単位の無い角度、彩度・輝度・透明度は 0%〜100% か 0.0〜1.0 で、範囲の外は切り詰める
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importXslFo, type ImportOptions } from '../src/xslfoImport';
import type { LBlock } from '../src/types';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const PM = '<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>';
const fo = (flow: string) => `<?xml version="1.0"?><fo:root ${NS}>${PM}<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
const first = (attrs: string, compat: ImportOptions['compat']) => {
  const r = importXslFo(fo(`<fo:block ${attrs}>a</fo:block>`), parse, { compat });
  return { b: r.document.sequences[0].flow.children[0] as LBlock, unsupported: r.report.unsupported };
};
const bg = (v: string) => first(`background-color="${v}"`, 'antenna').b.backgroundColor;

describe('XSL-FO の hsl()・hsla()', () => {
  it('互換モード: 純色・灰色・白・黒', () => {
    expect(bg('hsl(0, 100%, 50%)')).toBe('rgb(255,0,0)');
    expect(bg('hsl(120, 100%, 50%)')).toBe('rgb(0,255,0)');
    expect(bg('hsl(240, 100%, 50%)')).toBe('rgb(0,0,255)');
    expect(bg('hsl(0, 0%, 81%)')).toBe('rgb(207,207,207)');
    expect(bg('hsl(90, 75%, 100%)')).toBe('rgb(255,255,255)');
    expect(bg('hsl(90, 75%, 0%)')).toBe('rgb(0,0,0)');
    // 見本の説明では cornflowerblue (#6495ED) と「等価」。式どおりでは緑が 147.75 で 148 (説明の値は、おおよそ)
    expect(bg('hsl(219, 79%, 66%)')).toBe('rgb(100,148,237)');
  });
  it('互換モード: 0.0〜1.0 の数の書き方・100% を超える値の切り詰め・360 度を超える色相', () => {
    expect(bg('hsl(0, 1.0, 0.5)')).toBe('rgb(255,0,0)');
    expect(bg('hsl(0, 120%, 50%)')).toBe(bg('hsl(0, 100%, 50%)'));
    expect(bg('hsl(480, 100%, 50%)')).toBe(bg('hsl(120, 100%, 50%)'));
  });
  it('互換モード: hsla() の透明度は #rrggbbaa (1 なら不透明の rgb())', () => {
    expect(bg('hsla(0, 100%, 50%, 50%)')).toBe('#ff000080');
    expect(bg('hsla(0, 100%, 50%, 0.25)')).toBe('#ff000040');
    expect(bg('hsla(0, 100%, 50%, 1)')).toBe('rgb(255,0,0)');
  });
  it('互換モード: 罫線の一括指定の色と、字の色にも使える', () => {
    const r = first('border="2pt solid hsl(0, 0%, 81%)" color="hsl(240, 100%, 50%)"', 'antenna');
    expect((r.b.border as { top: { color: string } }).top.color).toBe('rgb(207,207,207)');
    expect(r.b.color).toBe('rgb(0,0,255)');
  });
  it('仕様モード: 読まずに、互換の指定のときだけの値として警告に出す', () => {
    const r = first('background-color="hsl(0, 100%, 50%)"', 'spec');
    expect(r.b.backgroundColor).toBeUndefined();
    expect(r.unsupported['color:hsl(0, 100%, 50%) (--compat antenna のときだけ解釈する値)']).toBe(1);
  });
  it('読めない hsl() は、どちらのモードでも未対応の色として知らせる', () => {
    expect(first('background-color="hsl(red, 1, 2)"', 'antenna').unsupported['color:hsl(red, 1, 2)']).toBe(1);
  });
  it('互換モード: 色相は単位の無い数だけを読む (turn・rad・grad・deg と知らない字は、未対応の色として捨てて知らせる)', () => {
    for (const h of ['0.5turn', '3rad', '200grad', '120deg', '120foo']) {
      const r = first(`background-color="hsl(${h}, 100%, 50%)"`, 'antenna');
      expect(r.b.backgroundColor).toBeUndefined();
      expect(r.unsupported[`color:hsl(${h}, 100%, 50%)`.slice(0, 26)]).toBe(1);
    }
    expect(bg('hsl(-120, 100%, 50%)')).toBe(bg('hsl(240, 100%, 50%)'));
  });
});
