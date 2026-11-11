/**
 * CSS の小さな残りの回帰テスト:
 *  - NC-10 @page の bleed: auto は、marks に crop があれば 6pt、無ければ 0 (CSS Paged Media 3 §7.3)
 *  - NC-16 text-spacing-trim の trim-all・space-first と、位置ごとの語の組 (CSS Text 4 §8.5)
 *  - NC-18 (7) 色の none の成分 (CSS Color 4 §4.4) と light-dark() (CSS Color 5 §7・CSS Color Adjust 1 §2)
 *  - 読まずに捨てていた指定を「未対応」の警告に出す: page-orientation (@page)・@page :nth()・target-counters()・@namespace・
 *    hanging-punctuation: last・shape-outside
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseHTML } from 'linkedom';
import { cascadeStyles, HTML_UA_CSS, supportsCssDeclaration } from '../src/cssCascade';
import { parseColor, resolveLightDark } from '../src/cssText';
import { unsupportedCssReport } from '../src/cssUnsupported';
import { parseCss } from '../src/htmlPaged';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import fs from 'node:fs';
import path from 'node:path';
import { ensureFonts, fontDir } from './helpers';
import { importHtml } from '../src/htmlImport';

const MM_6PT = (6 * 25.4) / 72;
/** CSS と本文 → 読み込みの結果 */
const imp = (css: string, body = '<p>a</p>', o: object = {}) => {
  const { document: d } = parseHTML(`<!doctype html><html><head></head><body>${body}</body></html>`);
  return importHtml(d as never, cascadeStyles(d as never, css, { uaCss: HTML_UA_CSS }), { css, ...o });
};
const masterOf = (css: string, o: object = {}) => imp(css, '<p>a</p>', o).document.sequences[0].master;

describe('NC-10 bleed: auto (CSS Paged Media 3 §7.3)', () => {
  it('marks に crop があれば 6pt', () => {
    expect(masterOf('@page { marks: crop; bleed: auto }').bleed).toBeCloseTo(MM_6PT, 5);
    expect(masterOf('@page { marks: crop cross; bleed: auto }').bleed).toBeCloseTo(MM_6PT, 5);
  });
  it('bleed を書かないとき (初期値の auto) も、marks に crop があれば 6pt', () => {
    expect(masterOf('@page { marks: crop }').bleed).toBeCloseTo(MM_6PT, 5);
  });
  it('marks に crop が無ければ 0 (cross だけ・none)', () => {
    expect(masterOf('@page { marks: cross; bleed: auto }').bleed).toBe(0);
    expect(masterOf('@page { bleed: auto }', { bleedMm: 3, trimMarks: false }).bleed).toBe(0);
  });
  it('長さはそのまま。@page に marks も bleed も無ければ、呼び出しの設定 (--print の 3mm) に従う', () => {
    expect(masterOf('@page { marks: crop; bleed: 3mm }').bleed).toBeCloseTo(3, 5);
    expect(masterOf('@page { size: A5 }', { bleedMm: 3, trimMarks: true }).bleed).toBe(3);
  });
});

describe('NC-16 text-spacing-trim (CSS Text 4 §8.5)', () => {
  /** body の中の p の行組みの指定 */
  const para = (style: string) => {
    const f = imp('', `<p style="${style}">「あ」</p>`).document.sequences[0].flow;
    const body = f.children[0] as unknown as { children: Array<Record<string, unknown>> };
    return body.children[0];
  };
  it('trim-all は、位置によらず約物を二分にする (punctuationTrimAll)', () => {
    expect(para('text-spacing-trim: trim-all')).toMatchObject({ punctuationTrimAll: true });
    expect(para('text-spacing-trim: normal').punctuationTrimAll).toBeUndefined();
  });
  it('space-first は、段落の 1 行目と強制改行の後の行を除いて行頭を詰める', () => {
    expect(para('text-spacing-trim: space-first')).toMatchObject({ punctuationTrimStart: true, punctuationTrimStartExceptFirst: true });
  });
  it('位置ごとの語の組 (省いた位置は trim-start trim-adjacent allow-end)', () => {
    expect(para('text-spacing-trim: trim-end')).toMatchObject({ punctuationTrimStart: true, punctuationTrimEnd: true });
    expect(para('text-spacing-trim: space-start trim-end')).toMatchObject({ punctuationTrimEnd: true });
    expect(para('text-spacing-trim: space-start trim-end').punctuationTrimStart).toBeUndefined();
    expect(para('text-spacing-trim: space-adjacent')).toMatchObject({ punctuationSqueeze: false, punctuationTrimStart: true });
  });
  it('一括指定の text-spacing の <spacing-trim> (CSS Text 4 §8.6)', () => {
    expect(para('text-spacing: trim-both ideograph-alpha')).toMatchObject({ punctuationTrimStart: true, punctuationTrimEnd: true });
    expect(para('text-spacing: trim-all')).toMatchObject({ punctuationTrimAll: true });
  });
});

describe('NC-18 (7) 色の none の成分 (CSS Color 4 §4.4)', () => {
  it('rgb()・hsl() の新しい構文の none は 0', () => {
    expect(parseColor('rgb(none 128 255)')).toEqual([0, 128, 255, 1]);
    expect(parseColor('rgb(255 none none / 50%)')).toEqual([255, 0, 0, 0.5]);
    expect(parseColor('rgba(10% 20% 30% / none)')).toEqual([26, 51, 77, 0]);
    expect(parseColor('hsl(none 100% 50%)')).toEqual([255, 0, 0, 1]);
    expect(parseColor('hsl(120 none 50%)')).toEqual([128, 128, 128, 1]);
    expect(parseColor('hsla(120deg 100% none)')).toEqual([0, 0, 0, 1]);
  });
  it('範囲の外の成分は、切り詰める (rgb()・hsl() は色域に収めない)', () => {
    expect(parseColor('rgb(300 none -5)')).toEqual([255, 0, 0, 1]);
  });
  it('カンマの古い構文には none を書けない', () => {
    expect(parseColor('rgb(none, 0, 0)')).toBeUndefined();
    expect(parseColor('hsl(none, 100%, 50%)')).toBeUndefined();
  });
  it('color-mix() の中の none は、もう一方の色の成分を引き継ぐ (§13.4)', () => {
    expect(parseColor('color-mix(in srgb, rgb(none 0 0), rgb(255 0 0))')).toEqual([255, 0, 0, 1]);
  });
  it('宣言が捨てられず、計算値になる', () => {
    const d = new DOMParser().parseFromString('<html><body><p id="a" style="color: rgb(none 0 255)">x</p></body></html>', 'text/html') as unknown as Document;
    expect(cascadeStyles(d, '', { uaCss: HTML_UA_CSS }).style(d.getElementById('a')!).getPropertyValue('color')).toBe('rgb(0, 0, 255)');
  });
});

describe('NC-18 (7) light-dark() (CSS Color 5 §7)', () => {
  const colorOf = (html: string, css = '', id = 'a') => {
    const d = new DOMParser().parseFromString(`<html><head>${html.startsWith('<meta') ? html : ''}</head><body>${html.startsWith('<meta') ? '<p id="a">x</p>' : html}</body></html>`, 'text/html') as unknown as Document;
    return cascadeStyles(d, css, { uaCss: HTML_UA_CSS }).style(d.getElementById(id)!).getPropertyValue('color');
  };
  it('既定 (color-scheme: normal) は light の色 (印刷の好みは light)', () => {
    expect(colorOf('<p id="a">x</p>', 'p { color: light-dark(red, blue) }')).toBe('rgb(255, 0, 0)');
    expect(parseColor('light-dark(red, blue)')).toEqual([255, 0, 0, 1]);
  });
  it('color-scheme: dark (light を含まない) の要素と子孫は dark の色。light dark は light', () => {
    const css = '.d { color-scheme: dark } .ld { color-scheme: light dark } .o { color-scheme: only dark } p { color: light-dark(red, blue) }';
    expect(colorOf('<div class="d"><p id="a">x</p></div>', css)).toBe('rgb(0, 0, 255)');
    expect(colorOf('<div class="ld"><p id="a">x</p></div>', css)).toBe('rgb(255, 0, 0)');
    expect(colorOf('<div class="o"><p id="a">x</p></div>', css)).toBe('rgb(0, 0, 255)');
  });
  it('ページの色の組 (<meta name="color-scheme">)', () => {
    expect(colorOf('<meta name="color-scheme" content="dark">', 'p { color: light-dark(red, blue) }')).toBe('rgb(0, 0, 255)');
  });
  it('一括指定・入れ子の色・入れ子の light-dark() の中も選ぶ', () => {
    const d = new DOMParser().parseFromString('<html><body><div style="color-scheme: dark"><p id="a" style="border: 1px solid light-dark(red, color-mix(in srgb, blue, light-dark(white, black)))">x</p></div></body></html>', 'text/html') as unknown as Document;
    expect(cascadeStyles(d, '', { uaCss: HTML_UA_CSS }).style(d.getElementById('a')!).getPropertyValue('border-top-color')).toBe('rgb(0, 0, 128)');
    expect(resolveLightDark('1px solid light-dark(red, light-dark(green, blue))', true)).toBe('1px solid blue');
  });
  it('2 つの色でなければ読めない (@supports も偽)', () => {
    expect(parseColor('light-dark(red)')).toBeUndefined();
    expect(parseColor('light-dark(red, 12px)')).toBeUndefined();
    expect(supportsCssDeclaration('color', 'light-dark(red, blue)')).toBe(true);
    expect(supportsCssDeclaration('color', 'light-dark(red)')).toBe(false);
    expect(supportsCssDeclaration('color-scheme', 'light dark')).toBe(true);
    expect(supportsCssDeclaration('color-scheme', 'only light only')).toBe(false);
  });
});

describe('未対応の指定を警告に出す', () => {
  const rep = (css: string, html?: string) => {
    const d = html ? (parseHTML(html).document as unknown as Document) : undefined;
    return unsupportedCssReport(parseCss(css), d);
  };
  it('@page の page-orientation (CSS Paged Media 3 §7.1.2)', () => {
    expect(rep('@page wide { page-orientation: rotate-left; size: A4 landscape }')).toEqual({ unsupported: { 'page-orientation': 1 }, unknown: {} });
  });
  it('@page :nth() (CSS GCPM 3 §3)', () => {
    expect(rep('@page :nth(2n+1) { margin: 1in } @page :first { margin: 2in }').unsupported).toEqual({ '@page :nth()': 1 });
  });
  it('target-counters() (CSS Content 3 §6.2。余白の箱の content も)', () => {
    const css = 'a::after { content: target-counters(attr(href url), item, ".") } @page { @top-center { content: target-counters(attr(href url), c, "-") } } b::after { content: target-counter(attr(href url), page) }';
    expect(rep(css).unsupported).toEqual({ 'target-counters()': 2 });
  });
  it('@namespace (CSS Namespaces 3 §2)', () => {
    expect(rep('@namespace svg url(urn:x-svg); p { color: red }').unsupported).toEqual({ '@namespace': 1 });
  });
  it('hanging-punctuation: last (CSS Text 3 §8.2.1)。first・allow-end は数えない', () => {
    const r = rep('p { hanging-punctuation: first allow-end last } q { hanging-punctuation: first }', '<html><body><p style="hanging-punctuation: last">x</p></body></html>');
    expect(r.unsupported).toEqual({ 'hanging-punctuation: last': 2 });
  });
  it('shape-outside・shape-margin・shape-image-threshold は未対応 (知らないプロパティではない。CSS Shapes 1 §6)', () => {
    expect(rep('.f { float: left; shape-outside: circle(50%); shape-margin: 1em; shape-image-threshold: 0.5 }')).toEqual({ unsupported: { 'shape-outside': 1, 'shape-margin': 1, 'shape-image-threshold': 1 }, unknown: {} });
  });
  it('typeset の warnings に「未対応」として出る', async () => {
    await ensureFonts(DEFAULT_FONTS.base);
    const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
    const loadFont = async (spec: FontSpec) => {
      const b = fs.readFileSync(fileOf(spec));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const css = '@namespace x url(urn:x); @page :nth(2) { margin: 1in } @page { page-orientation: rotate-left } p { shape-outside: circle(); hanging-punctuation: last }';
    const r = await typesetHtml(`<!DOCTYPE html><html><head><title>t</title><style>${css}</style></head><body><p>x</p></body></html>`, { name: 't.html', loadFont });
    const miss = r.warnings.find((w) => w.startsWith('未対応の CSS を無視しました: '));
    expect(miss).toBe('未対応の CSS を無視しました: @namespace、@page :nth()、hanging-punctuation: last、page-orientation、shape-outside');
    expect(r.warnings.some((w) => /知らない CSS/.test(w))).toBe(false);
  });
});
