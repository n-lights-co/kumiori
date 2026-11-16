/**
 * ページの余白の箱の、決まった向きの寸法と位置 (台帳 HTM-28 の K)。
 * CSS Page 3 §5.3.3: 上の箱の height・margin-top・margin-bottom が決まりすぎ (どれも auto でない) なら、margin-top を auto とする。
 * 下の箱は margin-bottom、左の箱は margin-left、右の箱は margin-right (§5.3.3 の終わりの段落)。なので、高さ・幅を指定した箱は
 * 本文の側に寄る。margin が両方 auto なら真ん中 (規則 6)。vertical-align は箱の中の中身の揃え (§6.3: 表のセルと同じ) で、箱の位置は変えない。
 * WeasyPrint 65.1 も同じ (layout/page.py の compute_fixed_dimension)。
 * (以前は、vertical-align で箱の位置を決め、既定は真ん中だった。WeasyPrint の見本との組み比べで見つかったもの)
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml, marginBoxFixedDimension } from '../src/htmlImport';

const doc = (body: string) => new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
type B = { left: number; top: number; width: number; height: number; blockAlign?: string };
/** 余白の箱 (静的コンテンツの、ページに置く箱)。ページ 200pt × 200pt、余白 40pt */
const boxes = (inner: string): B[] => {
  const css = `@page { size: 200pt 200pt; margin: 40pt; ${inner} }`;
  const d = doc('<p>x</p>');
  const r = importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css, measureText: (t, st) => t.length * st.fontSize * 0.5 });
  return (r.document.sequences[0].staticContent ?? []).filter((b) => (b as { absolutePosition?: boolean }).absolutePosition) as unknown as B[];
};
const one = (inner: string): B => {
  const bs = boxes(inner);
  expect(bs).toHaveLength(1);
  return bs[0];
};

describe('marginBoxFixedDimension (§5.3.3 の規則 1〜6)', () => {
  it('決まりすぎなら、ページの端の側の margin を auto にする', () => {
    expect(marginBoxFixedDimension(40, 0, 0, 20, 0, true)).toEqual({ a: 20, b: 0, size: 20 });
    expect(marginBoxFixedDimension(40, 0, 0, 20, 0, false)).toEqual({ a: 0, b: 20, size: 20 });
    expect(marginBoxFixedDimension(40, 5, 3, 20, 2, true)).toEqual({ a: 15, b: 3, size: 20 });
  });
  it('margin が両方 auto なら等しく、片方なら式から', () => {
    expect(marginBoxFixedDimension(40, 'auto', 'auto', 20, 0, true)).toEqual({ a: 10, b: 10, size: 20 });
    expect(marginBoxFixedDimension(40, 'auto', 4, 20, 0, false)).toEqual({ a: 16, b: 4, size: 20 });
  });
  it('size が auto なら、auto の margin は 0、size は残り', () => {
    expect(marginBoxFixedDimension(40, 'auto', 5, 'auto', 2, true)).toEqual({ a: 0, b: 5, size: 33 });
  });
  it('入りきらなければ、auto の margin は 0 (規則 2) で、決まりすぎの側を式から決める', () => {
    expect(marginBoxFixedDimension(40, 'auto', 'auto', 50, 0, true)).toEqual({ a: -10, b: 0, size: 50 });
  });
});

describe('高さ・幅を指定した余白の箱は、本文の側に寄せる', () => {
  it('上の箱: 下端を本文の上端 (40pt) に付ける (直す前は真ん中: top 10)', () => {
    const b = one('@top-center { content: "h"; height: 20pt }');
    expect(b.top).toBeCloseTo(20, 6);
    expect(b.height).toBeCloseTo(20, 6);
  });
  it('下の箱: 上端を本文の下端 (160pt) に付ける', () => {
    const b = one('@bottom-center { content: "f"; height: 20pt }');
    expect(b.top).toBeCloseTo(160, 6);
  });
  it('左の箱・右の箱: 本文の側の端に付ける (直す前は真ん中)', () => {
    const l = one('@left-middle { content: "l"; width: 10pt }');
    expect(l.left).toBeCloseTo(30, 6);
    expect(l.width).toBeCloseTo(10, 6);
    const r = one('@right-middle { content: "r"; width: 10pt }');
    expect(r.left).toBeCloseTo(160, 6);
  });
  it('隅の箱: 上下・左右とも本文の側', () => {
    const b = one('@top-left-corner { content: "c"; height: 20pt; width: 10pt }');
    expect(b.left).toBeCloseTo(30, 6);
    expect(b.top).toBeCloseTo(20, 6);
    const e = one('@bottom-right-corner { content: "c"; height: 20pt; width: 10pt }');
    expect(e.left).toBeCloseTo(160, 6);
    expect(e.top).toBeCloseTo(160, 6);
  });
  it('margin: auto なら真ん中、margin-bottom を指定すれば本文から離す', () => {
    expect(one('@top-center { content: "h"; height: 20pt; margin-top: auto; margin-bottom: auto }').top).toBeCloseTo(10, 6);
    expect(one('@top-center { content: "h"; height: 20pt; margin: auto 0 }').top).toBeCloseTo(10, 6);
    expect(one('@top-center { content: "h"; height: 20pt; margin-bottom: 5pt }').top).toBeCloseTo(15, 6);
  });
  it('vertical-align は箱の中の中身の揃えで、箱の位置は変えない (直す前は top で上端に置いた)', () => {
    const b = one('@top-center { content: "h"; height: 20pt; vertical-align: top }');
    expect(b.top).toBeCloseTo(20, 6);
    expect(b.blockAlign).toBe('start');
    expect(one('@top-center { content: "h"; height: 20pt }').blockAlign).toBe('center');
  });
  it('height は中身の高さ: 罫線と内側の余白を足した箱にする。box-sizing: border-box なら、それを含めた高さ', () => {
    const b = one('@top-center { content: "h"; height: 20pt; padding: 2pt 0 }');
    expect(b.height).toBeCloseTo(24, 6);
    expect(b.top).toBeCloseTo(16, 6);
    const c = one('@top-center { content: "h"; height: 20pt; padding: 2pt 0; box-sizing: border-box }');
    expect(c.height).toBeCloseTo(20, 6);
    expect(c.top).toBeCloseTo(20, 6);
  });
  it('高さの指定が無ければ、これまでどおり余白いっぱい (margin で縮める)', () => {
    const b = one('@top-center { content: "h"; margin-top: -3pt; padding-top: 3pt }');
    expect(b.top).toBeCloseTo(-3, 6);
    expect(b.height).toBeCloseTo(43, 6);
  });
});
