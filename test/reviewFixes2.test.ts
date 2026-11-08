/**
 * コードレビュー (2026-11-06) の中程度の欠陥の回帰テスト:
 *  - @media の媒体条件 (screen and (…) を印刷で真にしない。<style media>・<link media> の条件を評価する)
 *  - @layer の入れ子の順 (親の直下の宣言 > 入れ子の層。入れ子の層は親の層の中に並ぶ)
 *  - 論理的な性質 (margin-inline-start など) の値の検証、1 語だけの性質の検証、float: inline-start
 *  - 右から左の鏡像の字と、縦書きの横倒しの字の letter-spacing
 *  - 画面と API の互換の設定の統一 (compat.ts)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseHTML } from 'linkedom';
import { FAMILY, makeEngine } from './helpers';
import { cascadeStyles, HTML_UA_CSS } from '../src/cssCascade';
import { layerRanks, parseCss } from '../src/htmlPaged';
import { prepareHtml } from '../src/htmlPrepare';
import { importHtml } from '../src/htmlImport';
import { querySelectorAll } from '../src/cssSelector';
import { flattenInline, glyphNode, markBidi } from '../src/inlineLayout';
import { resolveStyle, type ResolvedStyle } from '../src/lnode';
import { AH_HTML_IMPORT_OPTIONS, ahCascadeOptions, compatLayoutOptions, compatPdfOptions, foLanguages, isAhCompat, loadFoHyphenators } from '../src/compat';
import { hyphenPositions } from '../src/hyphenation';
import type { LFloat } from '../src/types';

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  E = await makeEngine();
});

const parse = (html: string) => new DOMParser().parseFromString(`<html><head></head><body>${html}</body></html>`, 'text/html') as unknown as Document;
const byId = (doc: Document, id: string) => querySelectorAll(doc, `#${id}`)[0];
/** 自前のカスケードの計算値 */
const style = (html: string, css: string, id: string) => {
  const doc = parse(html);
  const s = cascadeStyles(doc, css, { uaCss: HTML_UA_CSS });
  return (p: string) => s.style(byId(doc, id)).getPropertyValue(p);
};
/** prepareHtml (印刷の媒体として読む) を通した計算値 */
const prepared = async (html: string, id: string) => {
  const p = await prepareHtml(html, [], 'browser', { width: 210, height: 297, margin: 20 }, (t) => parseHTML(t).document as unknown as Document);
  const s = cascadeStyles(p.doc, p.authorCss, { uaCss: HTML_UA_CSS, uaExtraCss: p.uaCss });
  return { css: p.authorCss, get: (prop: string) => s.style(byId(p.doc, id)).getPropertyValue(prop) };
};
const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';

describe('@media の媒体条件 (印刷として読む)', () => {
  it('screen and (max-width: 600px) は、印刷では (幅によらず) 効かない', async () => {
    const r = await prepared('<html><head><style>p { color: red } @media screen and (max-width: 600px) { p { color: blue } } @media only screen and (min-width: 100px) { p { color: blue } }</style></head><body><p id="p">x</p></body></html>', 'p');
    expect(r.get('color')).toBe(RED);
    expect(r.css).not.toMatch(/not all and/);
  });
  it('並びの中の screen だけを外し、print は all にする (screen, print and (orientation: portrait) は効く)', async () => {
    const r = await prepared('<html><head><style>p { color: red } @media screen, print and (orientation: portrait) { p { color: blue } } @media not screen { b { color: blue } }</style></head><body><p id="p">x</p></body></html>', 'p');
    expect(r.get('color')).toBe(BLUE);
    expect(r.css).toMatch(/@media not all, all and \(orientation: portrait\)/);
    expect(r.css).toMatch(/@media all \{ b/);
  });
  it('<style media> の条件は印刷の条件として評価する (A4 の幅 794px: max-width: 600px は効かず、min-width: 600px は効く)', async () => {
    const r1 = await prepared('<html><head><style>p { color: red }</style><style media="(max-width: 600px)">p { color: blue }</style></head><body><p id="p">x</p></body></html>', 'p');
    expect(r1.get('color')).toBe(RED);
    const r2 = await prepared('<html><head><style>p { color: red }</style><style media="print and (min-width: 600px)">p { color: blue }</style></head><body><p id="p">x</p></body></html>', 'p');
    expect(r2.get('color')).toBe(BLUE);
    // screen だけの <style> は使わない。print・all はそのまま
    const r3 = await prepared('<html><head><style media="print">p { color: red }</style><style media="screen">p { color: blue }</style></head><body><p id="p">x</p></body></html>', 'p');
    expect(r3.get('color')).toBe(RED);
  });
  it('<link media> の条件も同じ (一緒に選んだ CSS ファイル)', async () => {
    const html = '<html><head><link rel="stylesheet" href="a.css" media="(max-width: 600px)"><link rel="stylesheet" href="b.css" media="(min-width: 600px)"></head><body><p id="p">x</p></body></html>';
    const files = [
      { name: 'a.css', text: async () => 'p { color: blue }' },
      { name: 'b.css', text: async () => 'p { color: red }' },
    ];
    const p = await prepareHtml(html, files, 'browser', { width: 210, height: 297, margin: 20 }, (t) => parseHTML(t).document as unknown as Document);
    const s = cascadeStyles(p.doc, p.authorCss, { uaCss: HTML_UA_CSS, uaExtraCss: p.uaCss });
    expect(s.style(byId(p.doc, 'p')).getPropertyValue('color')).toBe(RED);
  });
});

describe('@layer の入れ子の順 (Cascade 5 §6.4)', () => {
  it('層の順位: 入れ子の層は親の中に並び、親の直下はその入れ子のどれよりも強い', () => {
    // a.x → a.y → a (直下) → b.p → b → c。a.x だけが現れた a も層になる
    const r = layerRanks(['a', 'a.x', 'b', 'a.y', 'b.p', 'c']);
    expect([...r.entries()].sort((p, q) => p[1] - q[1]).map(([n]) => n)).toEqual(['a.x', 'a.y', 'a', 'b.p', 'b', 'c']);
    expect([...layerRanks(['a.x', 'b']).keys()].sort()).toEqual(['a', 'a.x', 'b']);
  });
  it('層の直下の宣言は、その入れ子の層の宣言より強い (後に書いても)', () => {
    expect(style('<p id="p">x</p>', '@layer a { p { color: red } } @layer a.x { p { color: blue } }', 'p')('color')).toBe(RED);
    expect(style('<p id="p">x</p>', '@layer a { @layer x { p { color: blue } } p { color: red } }', 'p')('color')).toBe(RED);
    expect(style('<p id="p">x</p>', '@layer a { p { color: red } @layer x { p { color: blue } } }', 'p')('color')).toBe(RED);
  });
  it('a.x は a の中なので、後の層 b より弱い (後から現れた入れ子の層でも)', () => {
    expect(style('<p id="p">x</p>', '@layer a; @layer b; @layer b { p { color: red } } @layer a.x { p { color: blue } }', 'p')('color')).toBe(RED);
    // !important は逆 (先の層が強い)
    expect(style('<p id="p">x</p>', '@layer a; @layer b; @layer b { p { color: red !important } } @layer a.x { p { color: blue !important } }', 'p')('color')).toBe(BLUE);
  });
  it('parseCss の規則の layer は、同じ層なら同じ順位', () => {
    const { rules } = parseCss('@layer a { p { color: red } } @layer a.x { b { color: blue } } @layer a { i { color: green } } em { color: black }');
    const lay = Object.fromEntries(rules.map((r) => [r.selector, r.layer]));
    expect(lay.p).toBe(lay.i);
    expect(lay.b).toBeLessThan(lay.p!);
    expect(lay.em).toBeUndefined();
  });
});

describe('値の検証', () => {
  it('論理的な性質の読めない値は捨てる (物理的な性質と同じ検査)', () => {
    expect(style('<p id="p">x</p>', 'p { margin-left: 10px } p { margin-inline-start: foo }', 'p')('margin-left')).toBe('10px');
    expect(style('<p id="p">x</p>', 'p { border-left-style: solid; border-left-width: 1px } p { border-inline-start-width: foo }', 'p')('border-left-width')).toBe('1px');
    expect(style('<div id="d">x</div>', 'div { width: 100px } div { inline-size: 50% foo }', 'd')('width')).toBe('100px');
    // 読める値は使う
    expect(style('<div id="d">x</div>', 'div { width: 100px } div { inline-size: 50px }', 'd')('width')).toBe('50px');
    expect(style('<p id="p">x</p>', 'p { margin-inline-start: 1em; padding-block-end: 2px }', 'p')('margin-left')).toBe('16px');
  });
  it('1 語だけを取る性質 (text-align・writing-mode・border-*-style など) に語が 2 つあれば捨てる', () => {
    expect(style('<p id="p">x</p>', 'p { text-align: right } p { text-align: left center }', 'p')('text-align')).toBe('right');
    expect(style('<p id="p">x</p>', 'p { writing-mode: vertical-rl horizontal-tb }', 'p')('writing-mode')).toBe('horizontal-tb');
    expect(style('<p id="p">x</p>', 'p { border-top-style: solid dotted }', 'p')('border-top-style')).toBe('none');
    // text-transform は語を並べられる
    expect(style('<p id="p">x</p>', 'p { text-transform: uppercase full-width }', 'p')('text-transform')).toBe('uppercase full-width');
  });
  it('float: inline-start / inline-end は start / end の回り込み', () => {
    const doc = parse('<div><span id="a" style="float: inline-start">a</span><span id="b" style="float: inline-end">b</span>text</div>');
    const s = cascadeStyles(doc, '', { viewport: { width: 600, height: 800 } });
    const floats: string[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const o = n as { type?: string; float?: string; children?: unknown[] };
      if (o.type === 'float') floats.push((o as LFloat).float);
      for (const c of o.children ?? []) walk(c);
    };
    walk(importHtml(doc, s).document.sequences[0].flow);
    expect(floats).toEqual(['start', 'end']);
  });
});

const base = (over: Partial<ResolvedStyle> = {}): ResolvedStyle => ({
  fontFamily: FAMILY,
  fontWeight: 400,
  italic: false,
  fontSize: 10,
  lineHeight: 1.7,
  color: '#000',
  textAlign: 'start',
  textIndent: 0,
  letterSpacing: 0,
  rubyScale: 0.5,
  hanging: true,
  orphans: 2,
  widows: 2,
  wm: 'horizontal-tb',
  ...over,
});

describe('letter-spacing と字の差し替え', () => {
  it('右から左の段落で鏡像の字 (括弧) に差し替えても、字間は残る', () => {
    const st = resolveStyle(base({ letterSpacing: 2, direction: 'rtl' }), {});
    const atoms = flattenInline(['(abc)'], st, E.measurer);
    const before = atoms.map((a) => a.advance);
    markBidi(atoms, true, E.measurer, 'horizontal-tb');
    const close = E.measurer.glyph(')', { fontFamily: FAMILY, fontWeight: 400, fontSize: 10 }, 'horizontal-tb').advance;
    expect(atoms[0].first).toBe(')');
    expect(atoms[0].advance).toBeCloseTo(close + 2, 3);
    expect(atoms[0].g?.spacing).toBe(2);
    expect(atoms[0].lsTrail).toBe(2);
    // ( と ) の幅が同じ書体では、送りは差し替えの前後で変わらない
    expect(atoms.map((a) => a.advance).map((x) => x.toFixed(3))).toEqual(before.map((x) => x.toFixed(3)));
  });
  it('縦書きの横倒しの字は、送りに足した字間を中央寄せに数えない', () => {
    const st = resolveStyle(base({ wm: 'vertical-rl' }), {});
    const g = E.measurer.glyph('A', { fontFamily: FAMILY, fontWeight: 400, fontSize: 10 }, 'vertical-rl');
    expect(g.vertical?.mode).toBe('rotate');
    const plain = glyphNode(g, st, 'vertical-rl', 'A', 10, '#000').glyph!;
    const spaced = glyphNode({ ...g, advance: g.advance + 4, spacing: 4 }, st, 'vertical-rl', 'A', 10, '#000').glyph!;
    expect(plain.rotation).toBe(90);
    expect(spaced.baselineY).toBeCloseTo(plain.baselineY, 6);
  });
  it('flattenInline は字間・語間を g.spacing に残す', () => {
    const st = resolveStyle(base({ letterSpacing: 1.5, wordSpacing: 3 }), {});
    const atoms = flattenInline(['a b'], st, E.measurer);
    expect(atoms[0].g?.spacing).toBe(1.5);
    expect(atoms[1].g?.spacing).toBe(4.5);
  });
});

describe('互換の設定 (compat.ts: 画面と API で同じ)', () => {
  it('アンテナハウス互換かどうか', () => {
    expect(isAhCompat('fo', {})).toBe(true);
    expect(isAhCompat('fo', { compat: 'spec' })).toBe(false);
    expect(isAhCompat('html', { style: 'ah' })).toBe(true);
    expect(isAhCompat('html', { style: 'weasyprint' })).toBe(false);
  });
  it('組版・PDF・カスケード・読み込みの設定', () => {
    expect(compatLayoutOptions(true)).toEqual({ kernAh: true });
    expect(compatLayoutOptions(false)).toEqual({});
    expect(compatPdfOptions('fo', true)).toEqual({ svgFontUniqueNames: true, svgRootOverflowVisible: true, svgMarkerOverflowVisible: true });
    expect(compatPdfOptions('html', true)).toEqual({ svgFontUniqueNames: true, svgRootOverflowVisible: true });
    expect(compatPdfOptions('html', false)).toEqual({});
    const c = ahCascadeOptions('@font-face { font-family: A; font-weight: 600; src: url(a.otf) } @font-face { font-family: A; font-weight: 400; src: url(b.otf) }');
    expect(c.noBorderSnap).toBe(true);
    expect(c.ahBorderStyles).toBe(true);
    expect(c.ahCounterFlags).toBe(true);
    expect(c.relativeWeight?.('A, serif', 400, 'bolder')).toBe(600);
    expect(c.relativeWeight?.('B', 400, 'bolder')).toBeUndefined();
    expect(AH_HTML_IMPORT_OPTIONS.blankPageName).toBe('previous');
    expect(AH_HTML_IMPORT_OPTIONS.ahCounterPagePhysical).toBe(true);
  });
  it('XSL-FO の分綴: 文書に出てくる言語をすべて読み込む (ラテン語も)', async () => {
    const fo = '<fo:root xml:lang="de"><fo:block hyphenate="true" language="la">Gallia est omnis divisa</fo:block><fo:block xml:lang="none">x</fo:block></fo:root>';
    expect(foLanguages(fo)).toEqual(['de', 'la']);
    await loadFoHyphenators(fo);
    expect(hyphenPositions('divisa', 'la')?.length).toBeGreaterThan(0);
    expect(hyphenPositions('internationalization', undefined)?.length).toBeGreaterThan(0);
  });
});
