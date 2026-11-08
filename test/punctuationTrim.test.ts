/**
 * 約物の詰め。
 * - 中点類の後ろに始め括弧類が続くときは、始め括弧類の前の二分アキを詰める (JLREQ https://www.w3.org/TR/jlreq/?lang=ja
 *   2026-11-03 取得: 「中点類（cl-05） の後ろに 始め括弧類（cl-01） が連続する場合は，前の中点類の後ろを原則として 四分アキ とする」)
 * - text-spacing-trim の trim-start・trim-both は行頭の始め括弧類を二分に、trim-both は行末の終わり括弧類も二分に
 *   (CSS Text 4 §8.5 https://www.w3.org/TR/css-text-4/ 2026-11-05 取得)
 * - -ah-punctuation-trim の start・end などの組を、text-spacing-trim に読み替える
 * - text-autospace の初期値は normal (CSS Text 4 §8.4: ideograph-alpha ideograph-numeric と同じ)。none は値に無い (無効)。
 *   アンテナハウス互換 (jaDefaultsAh) では none を「空きを入れない」と読み、段落の 1 行目の行頭の始め括弧類を詰める
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { adjustJapaneseSpacing, type Atom } from '../src/inlineLayout';
import { AH_ALIASES } from '../src/htmlPaged';
import { importHtml } from '../src/htmlImport';
import { cascadeStyles } from '../src/cssCascade';
import type { LPageSequence } from '../src/types';
import type { LBlock } from '../src/types';

const st = { fontSize: 10 } as unknown as Atom['st'];
const glyph = (ch: string): Atom => ({ kind: 'glyph', first: ch, last: ch, advance: 10, isSpace: false, runId: 0, st }) as Atom;

describe('約物の詰め', () => {
  it('』・『: 』の後ろの二分と、『の前の二分を詰める (中点の前後の四分は残す)', () => {
    const a = ['』', '・', '『', '句'].map(glyph);
    adjustJapaneseSpacing(a);
    expect(a.map((x) => x.advance)).toEqual([5, 10, 5, 10]);
    expect(a[2].dx).toBe(-5);
  });
  it('-ah-punctuation-trim の読み替え', () => {
    const v = AH_ALIASES['-ah-punctuation-trim'].value;
    expect(v('none')).toBe('space-all');
    expect(v('start end adjacent')).toBe('trim-both');
    expect(v('start allow-end adjacent')).toBe('trim-both');
    expect(v('start')).toBe('trim-start');
    expect(v('adjacent')).toBe('normal');
    expect(v('all')).toBe('trim-all');
  });
  it('text-spacing-trim: trim-start は行頭の詰め、trim-both は行末の詰めも', () => {
    const conv = (css: string) => {
      const doc = new DOMParser().parseFromString(`<html><head></head><body><p>「あ」</p></body></html>`, 'text/html') as unknown as Document;
      const r = importHtml(doc, cascadeStyles(doc, css, { viewport: { width: 600, height: 800 } }), { css });
      // body の箱の中の p
      return (r.document.sequences[0].flow.children[0] as LBlock).children[0] as LBlock;
    };
    expect(conv('p { text-spacing-trim: trim-start }')).toMatchObject({ punctuationTrimStart: true });
    expect(conv('p { text-spacing-trim: trim-both }')).toMatchObject({ punctuationTrimStart: true, punctuationTrimEnd: true });
    expect(conv('p { -ah-punctuation-trim: start end adjacent }')).toMatchObject({ punctuationTrimStart: true, punctuationTrimEnd: true });
    expect(conv('p { color: red }').punctuationTrimStart).toBeUndefined();
  });
  it('text-autospace: 既定で和欧間アキを入れる。none は無効 (既定のまま)、アンテナハウス互換では空きを入れない', () => {
    const conv = (style: string, ah: boolean) => {
      const doc = new DOMParser().parseFromString(`<html><head></head><body><p style="${style}">日本語global</p></body></html>`, 'text/html') as unknown as Document;
      const r = importHtml(doc, cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } }), { css: '', ...(ah ? { jaDefaultsAh: true } : {}) });
      const seq = r.document.sequences[0] as LPageSequence;
      const p = (seq.flow.children[0] as LBlock).children[0] as LBlock;
      return { root: seq.textAutospace, p: p.textAutospace, paraStart: seq.punctuationTrimParagraphStart };
    };
    expect(conv('', false)).toEqual({ root: true, p: undefined, paraStart: undefined });
    expect(conv('text-autospace: none', false).p).toBeUndefined();
    expect(conv('text-autospace: no-autospace', false).p).toBe(false);
    expect(conv('text-autospace: none', true)).toEqual({ root: true, p: false, paraStart: true });
  });
});
