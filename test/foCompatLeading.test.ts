/**
 * XSL-FO の互換モード (compat: 'antenna') の行送りと基線:
 *  - 和文と欧文の混じる行も、行送りは line-height のまま (字の書体ごとの上下の違いで行を広げない)
 *  - 行の中の字の基線は、ブロックの nominal-font (XSL 1.1 §5.5.7。日本語の文書の serif なら和文の書体) の上下で決める。
 *    和文だけ・欧文だけ・混じる行のどれも、行の上端から基線までが同じ
 * 仕様モード (compat: 'spec') と、fontLineMetrics を直接付けた LNode (CSS と同じ決め方) の結果は変えない。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { importXslFo } from '../src/xslfoImport';
import { defaultFontBuffer, doc } from './helpers';
import type { LBlock } from '../src/types';

const JA = 'Noto Serif JP';
/** MS 明朝・MS ゴシックの上下の高さ (既定の和文の書体に当てている値。src/fontMapping.ts の setupDefaultFonts と同じ) */
const JA_DIFF = 0.859 - 0.141;
let fonts: FontManager;
let engine: LayoutEngine;
let tinosDiff: number;
beforeAll(async () => {
  fonts = new FontManager();
  await fonts.registerBuffer(JA, 400, await defaultFontBuffer('NotoSerifJP-Regular.ttf'), false);
  await fonts.registerBuffer('Tinos', 400, await defaultFontBuffer('Tinos-Regular.ttf'), false);
  fonts.setLatinFallback(JA, 'Tinos');
  fonts.get(JA, 400).ascentMinusDescent = JA_DIFF;
  tinosDiff = fonts.get('Tinos', 400).ascentMinusDescent;
  engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: JA });
});

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
const fo = (body: string, lang = 'ja') =>
  `<?xml version="1.0"?><fo:root ${NS} xml:lang="${lang}" font-family="serif" font-size="10pt" line-height="1.6"><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;

/** 行ごとの、最初の字の基線の位置 (ページの上端から) と、行の字 */
function baselines(sheet: unknown): Array<{ text: string; y: number }> {
  const out: Array<{ text: string; y: number }> = [];
  const visit = (n: unknown, oy: number, line: { text: string; y: number } | undefined) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((c) => visit(c, oy, line));
    const a = n as { type?: string; y?: number; baselineY?: number; text?: string };
    const y = oy + (a.y ?? 0);
    let cur = line;
    if (a.type === 'line') {
      cur = { text: '', y: NaN };
      out.push(cur);
    }
    if (a.type === 'glyph' && cur) {
      if (Number.isNaN(cur.y)) cur.y = y + (a.baselineY ?? 0);
      cur.text += a.text ?? '';
    }
    for (const [k, v] of Object.entries(a)) if (v && typeof v === 'object' && k !== 'margin' && k !== 'padding' && k !== 'border') visit(v, y, cur);
  };
  visit(sheet, 0, undefined);
  return out.filter((l) => l.text);
}
const pt = (mm: number) => (mm * 72) / 25.4;
const run = (body: string, compat: 'antenna' | 'spec', lang?: string) => baselines(engine.layout(importXslFo(fo(body, lang), parse, { compat }).document).sheets[0]);

/** 和文だけ 2 行・欧文だけ 2 行・混じる行 2 行・和文だけ 1 行 (強制改行は空の fo:block) */
const BODY =
  `<fo:block>和文だけの行<fo:block/>和文だけの行<fo:block/>Latin only<fo:block/>Latin only<fo:block/>和文と Latin の行<fo:block/>和文と Latin の行<fo:block/>和文だけの行</fo:block>`;

describe('XSL-FO 互換モードの行送りと基線 (和文と欧文の混じる行)', () => {
  it('10pt・line-height 1.6: 和文だけ・欧文だけ・混じる行のどれも、行送りは 16pt', () => {
    const ls = run(BODY, 'antenna');
    expect(ls.map((l) => l.text)).toEqual(['和文だけの行', '和文だけの行', 'Latin only', 'Latin only', '和文と Latin の行', '和文と Latin の行', '和文だけの行']);
    for (let i = 1; i < ls.length; i++) expect(ls[i].y - ls[i - 1].y, `${ls[i - 1].text} → ${ls[i].text}`).toBeCloseTo(16, 3);
  });

  it('基線は、ブロックの nominal-font (和文の書体) の上下に line-height を割り振った位置: 行の上端から (16 + 7.18) / 2 = 11.59pt', () => {
    const ls = run(BODY, 'antenna');
    const top = pt(10);
    // 1 行目 (和文だけ)
    expect(ls[0].y - top).toBeCloseTo((16 + JA_DIFF * 10) / 2, 3);
    // 欧文だけの行 (3 行目) も、混じる行 (5 行目) も、行の上端から同じ位置 (欧文の書体の上下では決めない)
    expect(ls[2].y - (top + 32)).toBeCloseTo((16 + JA_DIFF * 10) / 2, 3);
    expect(ls[4].y - (top + 64)).toBeCloseTo((16 + JA_DIFF * 10) / 2, 3);
    // 最後の行の下端 = 7 行 × 16pt (行の高さの合計が広がらない)
    expect(ls[6].y - top).toBeCloseTo(96 + (16 + JA_DIFF * 10) / 2, 3);
  });

  it('表の同じ行の、和文だけ・欧文だけ・混じるセルの基線がそろう', () => {
    const ls = run(
      `<fo:table table-layout="fixed" width="60mm"><fo:table-column column-width="20mm"/><fo:table-column column-width="20mm"/><fo:table-column column-width="20mm"/><fo:table-body>` +
        `<fo:table-row><fo:table-cell><fo:block>あいうえお</fo:block></fo:table-cell><fo:table-cell><fo:block>680</fo:block></fo:table-cell><fo:table-cell><fo:block>項目 1</fo:block></fo:table-cell></fo:table-row>` +
        `</fo:table-body></fo:table>`,
      'antenna',
    );
    expect(ls.map((l) => l.text)).toEqual(['あいうえお', '680', '項目 1']);
    expect(ls[1].y).toBeCloseTo(ls[0].y, 3);
    expect(ls[2].y).toBeCloseTo(ls[0].y, 3);
  });

  it('ブロックの字より大きい字のある行は変えない: 字の大きさの箱を囲み、ブロックの半行間を上下に足す (XSL 1.1 §4.5 の max-height)', () => {
    const ls = run(`<fo:block>和文と <fo:inline font-size="20pt">大</fo:inline> の行<fo:block/>和文と Latin の行<fo:block/>和文だけの行</fo:block>`, 'antenna');
    const top = pt(10);
    const br = fonts.get(JA, 400).baselineRatio;
    const half = (16 - 10) / 2;
    // 1 行目: 上は 20pt の字の箱の上 + 半行間、下は 20pt の字の箱の下 + 半行間
    expect(ls[0].y - top).toBeCloseTo(br * 20 + half, 3);
    expect(ls[1].y - ls[0].y).toBeCloseTo((1 - br) * 20 + half + (16 + JA_DIFF * 10) / 2, 3);
    // 2 行目 (同じ大きさの字の混じる行) から 3 行目は 16pt
    expect(ls[2].y - ls[1].y).toBeCloseTo(16, 3);
  });

  it('欧文の文書 (xml:lang="en") の nominal-font は欧文の書体: 欧文だけの行の基線は欧文の書体の上下で決まり、行送りは 16pt', () => {
    const ls = run(`<fo:block>Latin only<fo:block/>Latin only<fo:block/>Latin と和文<fo:block/>Latin only</fo:block>`, 'antenna', 'en');
    const top = pt(10);
    expect(ls[0].y - top).toBeCloseTo((16 + tinosDiff * 10) / 2, 3);
    for (let i = 1; i < ls.length; i++) expect(ls[i].y - ls[i - 1].y).toBeCloseTo(16, 3);
  });

  it('仕様モードの結果は変わらない: 行送り 16pt、基線は最初に使える書体 (欧文の書体) の上下', () => {
    const ls = run(BODY, 'spec');
    for (let i = 1; i < ls.length; i++) expect(ls[i].y - ls[i - 1].y).toBeCloseTo(16, 3);
    const f = fonts.get('Tinos', 400);
    const asc = f.ascent ?? f.baselineRatio;
    const desc = f.descent ?? 1 - f.baselineRatio;
    expect(ls[0].y - pt(10)).toBeCloseTo((16 - (asc + desc) * 10) / 2 + asc * 10, 3);
  });

  it('fontLineMetrics を直接付けた LNode (互換モードの印の無いブロック) は、いままでどおり字ごとの書体の上下で決め、混じる行は広がる', () => {
    const h = (children: string[]) => {
      const t = engine.layout(doc([{ type: 'block', fontFamily: JA, fontSize: 10, lineHeight: 1.6, fontLineMetrics: true, children } as LBlock]));
      const ls = baselines(t.sheets[0]);
      return ls[1].y - ls[0].y;
    };
    expect(h(['和文だけ\n和文だけ'])).toBeCloseTo(16, 3);
    // 和文 (0.718 em) と Tinos の字が同じ行にあると、上は和文、下は欧文の値になって広がる
    expect(h(['和文と Latin\n和文と Latin'])).toBeCloseTo((16 + JA_DIFF * 10) / 2 + (16 - tinosDiff * 10) / 2, 3);
    expect(tinosDiff).toBeLessThan(JA_DIFF);
  });
});
