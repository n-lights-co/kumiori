/**
 * 中身の幅 (max-content・min-content) の見積もりにも、行を組むときと同じカーニングを足す (利用者の報告)。
 * フレックスの項目 (display: flex の子) の幅は、HTML の読み込みで中身の幅を見積もって決める (htmlImport.ts の textWidth → measureText)。
 * 見積もりがカーニングを足さず、行を組むときは足すので、カーニングで広がる字の組 (SamsungOne の "2.2" など) が項目の幅に入りきらず、
 * overflow-wrap: break-word で "2." と "2" に割れていた。CSS Fonts 4 §6.3 (font-kerning)、CSS Sizing 3 §5.1 (max-content)
 *
 * テストの書体は Noto Sans JP (欧文の組 r: ・k. を、書体の kern で広げる)。@font-face で読み、欧文もその書体で組む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { typeset, type FontSpec } from '../src/index';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { defaultFontBuffer, fontDir } from './helpers';

const loadFont = async (spec: FontSpec) => defaultFontBuffer(path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
let data: Uint8Array;
beforeAll(async () => {
  await defaultFontBuffer('NotoSansJP-Regular.ttf');
  data = new Uint8Array(fs.readFileSync(path.join(fontDir, 'NotoSansJP-Regular.ttf')));
});

/** 行の箱ごとの字の並び (本文の領域の中を、上から順に) */
function lineTexts(r: Awaited<ReturnType<typeof typeset>>): string[] {
  const out: string[] = [];
  const visit = (a: { type: string; text?: string; children?: unknown[] }) => {
    if (a.type === 'line') {
      let t = '';
      const v = (b: { type: string; text?: string; children?: unknown[] }) => {
        if (b.type === 'glyph') t += b.text;
        for (const c of (b.children ?? []) as (typeof b)[]) v(c);
      };
      v(a);
      out.push(t);
      return;
    }
    for (const c of (a.children ?? []) as (typeof a)[]) visit(c);
  };
  visit(r.areaTree.sheets[0].page.regionBody as never);
  return out;
}

const flex = (kerning: string, wrap: string, extra = '') =>
  `<style>@font-face{font-family:K;src:url(k.ttf)} .f{display:flex;gap:10pt;font:20pt K;font-kerning:${kerning};overflow-wrap:${wrap};${extra}} .f>div{flex:none}</style>` +
  '<div class="f"><div>r:r</div><div>X</div><div>k.k</div><div>X</div><div>r;r:</div></div>';

describe('フレックスの項目の幅 (max-content) に、行を組むときと同じカーニングを足す', () => {
  for (const wrap of ['break-word', 'anywhere', 'normal']) {
    it(`font-kerning: auto・overflow-wrap: ${wrap} で、カーニングで広がる字の並びが割れない (直す前は "r:" と "r" に割れた)`, async () => {
      const r = await typeset(flex('auto', wrap), { loadFont, fetchImages: false, fetchStyles: false, files: [{ name: 'k.ttf', data }] });
      expect(lineTexts(r)).toEqual(['r:r', 'X', 'k.k', 'X', 'r;r:']);
    });
  }
  it('font-kerning: none と font-feature-settings: "kern" 0 も、これまでどおり割れない', async () => {
    for (const html of [flex('none', 'break-word'), flex('auto', 'break-word', 'font-feature-settings:"kern" 0')]) {
      const r = await typeset(html, { loadFont, fetchImages: false, fetchStyles: false, files: [{ name: 'k.ttf', data }] });
      expect(lineTexts(r)).toEqual(['r:r', 'X', 'k.k', 'X', 'r;r:']);
    }
  });
});

describe('Measurer.textAdvance: 送りの合計に、カーニングを足す', () => {
  it('kerning なら、組 (r の後ろの :) の書体の kern を足す。kerning でなければ、送りの合計だけ', async () => {
    const fonts = new FontManager();
    await fonts.registerBuffer('K', 400, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, false);
    const m = new Measurer(fonts, 'fontkit');
    const st = { fontFamily: 'K', fontWeight: 400, fontSize: 20 };
    const plain = m.glyphs('r:r', st, 'horizontal-tb').reduce((a, g) => a + g.advance, 0);
    const k = m.kern('r', ':', st) * 20;
    // 前提: この書体は r: を広げる (正のカーニング)。:r は広げない
    expect(k).toBeGreaterThan(0);
    expect(m.textAdvance('r:r', st)).toBeCloseTo(plain, 6);
    expect(m.textAdvance('r:r', st, { kerning: true })).toBeCloseTo(plain + k + m.kern(':', 'r', st) * 20, 6);
    // 和文の字の組には掛けない (行を組むときと同じ判定)
    expect(m.textAdvance('あい', st, { kerning: true })).toBeCloseTo(m.textAdvance('あい', st), 6);
  });
});
