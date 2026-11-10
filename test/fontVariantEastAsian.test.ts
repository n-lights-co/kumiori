/**
 * font-variant-east-asian (CSS Fonts 4 §6.10): 値を OpenType の機能に写して、書体に渡す。
 *   jis78 → jp78、jis83 → jp83、jis90 → jp90、jis04 → jp04、simplified → smpl、traditional → trad、
 *   full-width → fwid、proportional-width → pwid、ruby → ruby
 * 一括指定の font-variant (§6.11) からも読む。font-feature-settings の機能は、その後に足す (§7.2 の順)。
 * 字形と送りが変わることは、機能を持つ書体 (Noto Sans JP の OTF の版。jp83・jp90・fwid・pwid を持つ) で確かめる
 */
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { extraTestFont, walk } from './helpers';
import type { GlyphArea, LBlock, LInline } from '../src/types';

function load(body: string, css = '') {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  return importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css });
}
/** 木の中の、fontFeatures を持つ節の機能の並び (文書の順) */
function features(body: string, css = ''): string[] {
  const out: string[] = [];
  const w = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(w);
    const o = n as Record<string, unknown>;
    if (Array.isArray(o.fontFeatures)) out.push((o.fontFeatures as string[]).join(','));
    for (const k of Object.keys(o)) if (k !== 'fontFeatures') w(o[k]);
  };
  w(load(body, css).document.sequences[0].flow);
  return out;
}

describe('font-variant-east-asian (CSS Fonts 4 §6.10)', () => {
  it('値を OpenType の機能に写す', () => {
    const vals: Array<[string, string]> = [
      ['jis78', 'jp78'],
      ['jis83', 'jp83'],
      ['jis90', 'jp90'],
      ['jis04', 'jp04'],
      ['simplified', 'smpl'],
      ['traditional', 'trad'],
      ['full-width', 'fwid'],
      ['proportional-width', 'pwid'],
      ['ruby', 'ruby'],
    ];
    for (const [v, f] of vals) expect(features(`<p><span style="font-variant-east-asian: ${v}">字</span></p>`), v).toEqual([f]);
  });

  it('字形の版・幅・ruby は組み合わせられる。初期値 normal では機能を渡さない', () => {
    expect(features('<p><span style="font-variant-east-asian: jis78 proportional-width ruby">字</span></p>')).toEqual(['jp78,pwid,ruby']);
    expect(features('<p><span style="font-variant-east-asian: normal">字</span></p>')).toEqual([]);
    expect(features('<p>字</p>')).toEqual([]);
  });

  it('受け継ぐ。子の normal で打ち消す', () => {
    expect(features('<div style="font-variant-east-asian: jis90"><p>字<span style="font-variant-east-asian: normal">字</span></p></div>')).toEqual(['jp90', '']);
  });

  it('一括指定の font-variant からも読む。font-variant-numeric・font-feature-settings の機能と並ぶ (font-feature-settings が後。§7.2)', () => {
    expect(features('<p><span style="font-variant: traditional full-width">字</span></p>')).toEqual(['trad,fwid']);
    expect(features('<p><span style="font-variant: tabular-nums jis04">字</span></p>')).toEqual(['tnum,jp04']);
    expect(features(`<p><span style="font-variant-east-asian: jis83; font-feature-settings: 'palt'">字</span></p>`)).toEqual(['jp83,palt']);
    // 一括指定は、書いていない個別の指定を初期値に戻す
    expect(features('<div style="font-variant-east-asian: jis78"><p><span style="font-variant: normal">字</span></p></div>')).toEqual(['jp78', '']);
  });

  it('構文に合わない値 (同じ組から 2 つ・知らない語) の宣言は捨てる', () => {
    expect(features('<p><span style="font-variant-east-asian: jis78 jis83">字</span></p>')).toEqual([]);
    expect(features('<p><span style="font-variant-east-asian: full-width proportional-width">字</span></p>')).toEqual([]);
    expect(features('<p><span style="font-variant-east-asian: half-width">字</span></p>')).toEqual([]);
    expect(features('<p><span style="font-variant-east-asian: normal ruby">字</span></p>')).toEqual([]);
  });

  describe('機能を持つ書体で組む', () => {
    const FAMILY = 'Noto Sans JP OTF';
    let engine: LayoutEngine;
    beforeAll(async () => {
      const fonts = new FontManager();
      const buf = fs.readFileSync(await extraTestFont('NotoSansJP-Regular-v25.otf'));
      await fonts.registerBuffer(FAMILY, 400, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, false);
      engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY });
    });
    const glyphs = (body: string, wm = '') => {
      const r = load(`<div style="font-family: '${FAMILY}'; font-size: 10pt; ${wm}">${body}</div>`);
      const out: GlyphArea[] = [];
      for (const s of engine.layout(r.document).sheets) walk(s.page.regionBody, (a) => void (a.type === 'glyph' && out.push(a as GlyphArea)));
      return out;
    };

    it('proportional-width は約物の送りを詰め、full-width は欧文の字を全角の送りにする', () => {
      const [a, b] = glyphs('<p>（<span style="font-variant-east-asian: proportional-width">（</span></p>');
      expect(a.advance).toBeCloseTo(10, 3);
      expect(a.features).toBeUndefined();
      expect(b.advance).toBeLessThan(5);
      expect(b.features).toEqual(['pwid']);
      const [c, d] = glyphs('<p>A<span style="font-variant-east-asian: full-width">A</span></p>');
      expect(c.advance).toBeLessThan(8);
      expect(d.advance).toBeCloseTo(10, 3);
      expect(d.features).toEqual(['fwid']);
    });

    it('縦書きでは、ほかの font-variant-*・font-feature-settings と同じく、字形を差し替える機能を渡さない (縦書き用の字形 vert だけ)', () => {
      const [a, b] = glyphs('<p>（<span style="font-variant-east-asian: proportional-width">（</span></p>', 'writing-mode: vertical-rl');
      expect(b.features).toEqual(a.features);
      expect(b.advance).toBeCloseTo(a.advance, 6);
    });

    it('jis90 は字形を差し替える機能として字に付く (送りは変わらない)', () => {
      const [a, b] = glyphs('<p>辻<span style="font-variant-east-asian: jis90">辻</span></p>');
      expect(a.features).toBeUndefined();
      expect(b.features).toEqual(['jp90']);
      expect(b.advance).toBeCloseTo(a.advance, 6);
    });
  });
});

// 使っていない文書の木は変わらない: 初期値では fontFeatures の欄を作らない
describe('font-variant-east-asian を使わない文書', () => {
  it('fontFeatures の欄は増えない (ルビの注釈の UA の既定 font-variant-east-asian: ruby も、親文字と本文には及ばない)', () => {
    const flow = load('<p>本文<ruby>漢<rt>かん</rt></ruby>の<b>字</b></p>').document.sequences[0].flow;
    expect(JSON.stringify(flow)).not.toContain('fontFeatures');
    const p = ((flow.children[0] as LBlock).children as LBlock[])[0];
    expect((p.children as Array<string | LInline>).length).toBeGreaterThan(0);
  });
});
