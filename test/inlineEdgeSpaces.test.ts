/**
 * 読み込みの 3 つの直し (目次の項目名の調査で見つけたもの):
 *  - 行内の要素の端の空白を消さない (CSS Text 3 §4.1.1・§4.1.2)。直す前は「word <b>bold </b>word」が「boldword」、
 *    「<span class="n"></span>」の ::before の「第1章 」の後ろの空白が消えて「第1章Overview」になった (英語と日本語の混ざる目次の項目名)。
 *    行内の要素の境目をまたいで重なる空白は 1 つに詰め、行の頭・終わりの空白は消す
 *  - 縦並びの flex の項目 (行内の要素・直下の文字・::before・::after) をブロック化する (Flexbox 1 §4・CSS Display 3 §2.7)。
 *    直す前は <span> の項目が横に並んだ
 *  - flex の項目の中身の幅の見積もり (flex-wrap の行分けの目安) に、要素の間の空白・行内の箱の余白と枠・::before の中身・語間・
 *    inline-block の幅を数える
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import type { LTable } from '../src/types';

function load(body: string, css = '') {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  return importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css }).document;
}

type N = { type?: string; children?: unknown[]; absolutePosition?: boolean };
/** 最初の段落 (文字列を子に持つ最初のブロック) の字 (行内の要素の中もつなぐ。絶対配置の箱の中は数えない) */
function paraText(doc: unknown): string {
  const text = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' && !(n as N).absolutePosition && (n as N).type === 'inline' ? ((n as N).children ?? []).map(text).join('') : '');
  let found: string | undefined;
  const visit = (n: unknown) => {
    if (found !== undefined || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const o = n as N;
    if (o.type === 'block' && o.children?.some((c) => typeof c === 'string' || (c as N)?.type === 'inline')) {
      found = o.children.map(text).join('');
      return;
    }
    for (const v of Object.values(o)) visit(v);
  };
  visit(doc);
  return found ?? '';
}

describe('行内の要素の端の空白 (CSS Text 3 §4.1.1・§4.1.2)', () => {
  const cases: Array<[string, string, string?]> = [
    ['<p>word <b>bold </b>word</p>', 'word bold word'],
    ['<p>word<b> bold</b> word</p>', 'word bold word'],
    ['<p>Over<b> B </b>view</p>', 'Over B view'],
    // 境目をまたいで重なる空白は 1 つ
    ['<p>word <b> bold</b> x</p>', 'word bold x'],
    ['<p>a <i> <b> b </b> </i> c</p>', 'a b c'],
    // 行の頭・終わりの空白は消す
    ['<p><b> bold </b></p>', 'bold'],
    // 中身の空の要素の ::before・::after の端の空白 (目次の章番号)
    ['<p><span class="n"></span>Overview</p>', 'A. Overview', '.n::before{content:"A. "}'],
    ['<p>Over<span class="m"></span>view</p>', 'Over B view', '.m::after{content:" B "}'],
    // 英語と日本語の混ざる項目名
    ['<p><b>eco </b>モードの使い方</p>', 'eco モードの使い方'],
    // 空白を残す要素の中は変えない
    ['<p>a <span style="white-space: pre">  b  </span> c</p>', 'a   b   c'],
  ];
  for (const [body, want, css] of cases) {
    it(body, () => {
      expect(paraText(load(body, css))).toBe(want);
    });
  }
  it('絶対配置の箱は行の区切りにしない (前後の空白は、そのまま詰める)', () => {
    expect(paraText(load('<p>ooo <span style="position: absolute">S</span><span>Z</span></p>'))).toBe('ooo Z');
  });
});

describe('縦並びの flex の項目のブロック化 (Flexbox 1 §4)', () => {
  /** 容器 (class="f") のブロックの子の種類 */
  const kids = (body: string, css: string) => {
    let out: string[] = [];
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(visit);
      const o = n as N & { children?: unknown[] };
      if (out.length === 0 && (o.type === 'block' || o.type === 'block-container') && o.children && o.children.length >= 2 && o.children.every((c) => c && typeof c === 'object')) {
        out = o.children.map((c) => (c as N).type ?? '?');
        return;
      }
      for (const v of Object.values(o)) visit(v);
    };
    visit(load(body, css));
    return out;
  };
  it('行内の要素の項目は、ブロックとして縦に積む', () => {
    expect(kids('<div class="f"><span>AAA</span><span>BBB</span></div>', '.f{display:flex;flex-direction:column}')).toEqual(['block', 'block']);
  });
  it('直下の文字の並びは無名の項目、::before・::after も項目', () => {
    expect(kids('<div class="f">aaa <b>bbb</b> ccc</div>', '.f{display:flex;flex-direction:column}')).toEqual(['block', 'block', 'block']);
    expect(kids('<div class="f"><span>AAA</span></div>', '.f{display:flex;flex-direction:column} .f::before{content:"P"} .f::after{content:"Q"}')).toEqual(['block', 'block', 'block']);
  });
});

describe('flex の項目の中身の幅の見積もり (flex-wrap の行分けの目安)', () => {
  // 字を測らないとき (measureText が無い) の見積もりは、欧字 1 字 0.55em。10pt で 5.5pt
  const est = (title: string, css = '') => {
    const doc = load(`<div class="f"><span class="t">${title}</span><span class="l"></span></div>`, '.f{display:flex;flex-wrap:wrap;font-size:10pt} .l{flex:1} ' + css);
    let t: LTable | undefined;
    const visit = (n: unknown) => {
      if (t || !n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(visit);
      if ((n as N).type === 'table') t = n as LTable;
      else for (const v of Object.values(n)) visit(v);
    };
    visit(doc);
    return t!.columns[0].width as number;
  };
  it('要素の間の空白を数える (空白も 1 字)', () => {
    expect(est('<b>ab</b> <b>cd</b>')).toBeCloseTo(5 * 5.5, 3);
  });
  it('行内の箱の余白・枠・内側の余白を数える', () => {
    expect(est('<span style="margin-right:3pt;padding:0 2pt;border-left:3pt solid">ab</span>cd')).toBeCloseTo(4 * 5.5 + 3 + 4 + 3, 3);
  });
  it('::before の中身と語間を数える', () => {
    expect(est('<span class="n"></span>ab', '.n::before{content:"x "}')).toBeCloseTo(4 * 5.5, 3);
    expect(est('ab cd', '.t{word-spacing:2pt}')).toBeCloseTo(5 * 5.5 + 2, 3);
  });
  it('inline-block は、その幅と余白', () => {
    expect(est('<span style="display:inline-block;width:20pt;margin-right:1pt">x</span>ab')).toBeCloseTo(20 + 1 + 2 * 5.5, 3);
  });
});
