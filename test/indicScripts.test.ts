import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { doc, extraTestFont, fontBuffer, FAMILY } from './helpers';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { clusterUnits, graphemeClusters } from '../src/grapheme';
import type { Area, GlyphArea } from '../src/types';

/**
 * デーヴァナーガリー以外のインド系の文字 (ベンガル・グルムキー・タミル・カンナダ・マラヤーラム・シンハラ) を組む。
 *  - 字の単位 (grapheme.ts の clusterUnits): UAX #29 の GB9c が効かない文字 (グルムキー・カンナダ・タミル・シンハラ) の結合子音を、
 *    1 つの単位にする (UAX #29 §3 の aksara のあつらえ・CSS Text 3 §1.4)
 *  - 書体の整形の補い (fontkitShaping.ts の 5〜10)
 *  - 字の単位の間の詰め (Measurer.clusterKern)
 * 字形の番号と位置は、手元で HarfBuzz と照合して確かめたもの (ここでは、直した誤りが戻らないことを、字形の数・種類で固定する)。
 * 書体: Noto Sans の各文字と Noto Serif Bengali (テストが取得する。helpers.ts の EXTRA_TEST_FONTS)
 */
let fonts: FontManager;
let measurer: Measurer;
let engine: LayoutEngine;
const buf = async (name: Parameters<typeof extraTestFont>[0]) => {
  const b = fs.readFileSync(await extraTestFont(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  fonts = new FontManager();
  await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
  await fonts.registerBuffer('Beng', 400, await buf('NotoSansBengali-Regular-v33.ttf'), false);
  await fonts.registerBuffer('BengSerif', 400, await buf('NotoSerifBengali-Regular-v31.ttf'), false);
  await fonts.registerBuffer('Guru', 400, await buf('NotoSansGurmukhi-Regular-v29.ttf'), false);
  await fonts.registerBuffer('Taml', 400, await buf('NotoSansTamil-Regular-v31.ttf'), false);
  await fonts.registerBuffer('Knda', 400, await buf('NotoSansKannada-Regular-v32.ttf'), false);
  await fonts.registerBuffer('Mlym', 400, await buf('NotoSansMalayalam-Regular-v29.ttf'), false);
  await fonts.registerBuffer('Sinh', 400, await buf('NotoSansSinhala-Regular-v36.ttf'), false);
  measurer = new Measurer(fonts, 'fontkit');
  engine = new LayoutEngine(fonts, measurer, { defaultFontFamily: FAMILY });
});

/** 1 行に組んだ字 (GlyphArea) と、その左端の位置 (pt) */
const glyphAreas = (text: string, family: string, extra: object = {}): Array<GlyphArea & { left: number }> => {
  const out: Array<GlyphArea & { left: number }> = [];
  const visit = (a: Area, ox: number) => {
    const x = ox + a.x;
    if (a.type === 'glyph') out.push(Object.assign(a, { left: x }));
    for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
  };
  for (const c of engine.layout(doc([{ type: 'block', textAlign: 'start', fontFamily: family, kerning: true, children: [text], ...extra }] as never)).sheets[0].page.regionBody.children) visit(c, 0);
  return out;
};
const nominal = (family: string, ch: string) => fonts.get(family, 400).fk.glyphForCodePoint(ch.codePointAt(0)!).id;
const ids = (text: string, family: string) => glyphAreas(text, family).flatMap((a) => a.glyphIds ?? [undefined]);

describe('字の単位: Indic_Conjunct_Break の無い文字の結合子音を 1 つの単位にする', () => {
  it('UAX #29 の既定 (graphemeClusters) は変えない: カンナダの結合子音は「子音 + ヴィラーマ」と次の子音に分かれる', () => {
    expect(graphemeClusters('ಕನ್ನಡ')).toEqual(['ಕ', 'ನ್', 'ನ', 'ಡ']);
    expect(graphemeClusters('க்ஷ')).toEqual(['க்', 'ஷ']);
    expect(graphemeClusters('ශ්‍රී')).toEqual(['ශ්‍', 'රී']);
  });
  it('カンナダ: 子音 + ヴィラーマ + 子音 は 1 つ。3 つの子音・母音記号つきも 1 つ', () => {
    expect(clusterUnits('ಕನ್ನಡ')).toEqual(['ಕ', 'ನ್ನ', 'ಡ']);
    expect(clusterUnits('ಸ್ತ್ರೀ')).toEqual(['ಸ್ತ್ರೀ']);
    expect(clusterUnits('ರಾಷ್ಟ್ರ')).toEqual(['ರಾ', 'ಷ್ಟ್ರ']);
  });
  it('グルムキー: 下に付く子音 (ਪ੍ਰ・ੜ੍ਹ) は 1 つ', () => {
    expect(clusterUnits('ਪ੍ਰੇਮ')).toEqual(['ਪ੍ਰੇ', 'ਮ']);
    expect(clusterUnits('ਪੜ੍ਹ')).toEqual(['ਪ', 'ੜ੍ਹ']);
  });
  it('タミル: 合字になる க்ஷ と ஸ்ரீ・ஶ்ரீ だけ 1 つ。ほかの「子音 + プッリ + 子音」は分かれる', () => {
    expect(clusterUnits('க்ஷ')).toEqual(['க்ஷ']);
    expect(clusterUnits('லக்ஷ்மி')).toEqual(['ல', 'க்ஷ்', 'மி']);
    expect(clusterUnits('ஸ்ரீ')).toEqual(['ஸ்ரீ']);
    expect(clusterUnits('ஶ்ரீ')).toEqual(['ஶ்ரீ']);
    expect(clusterUnits('பக்கம்')).toEqual(['ப', 'க்', 'க', 'ம்']);
    expect(clusterUnits('ஸ்க')).toEqual(['ஸ்', 'க']);
  });
  it('シンハラ: ヴィラーマ + ZWJ + 子音 (結合・ラカーランサヤ・ヤンサヤ・レパヤ) は 1 つ。ZWJ が無ければ分かれる', () => {
    expect(clusterUnits('ශ්‍රී')).toEqual(['ශ්‍රී']);
    expect(clusterUnits('විද්‍යාව')).toEqual(['වි', 'ද්‍යා', 'ව']);
    expect(clusterUnits('ධර්‍ම')).toEqual(['ධ', 'ර්‍ම']);
    expect(clusterUnits('ක්ෂ')).toEqual(['ක්', 'ෂ']);
    // 接する字: 子音 + ZWJ + ヴィラーマ + 子音
    expect(clusterUnits('ක‍්ව')).toEqual(['ක‍්ව']);
  });
  it('ヴィラーマの後ろの ZWNJ (結合しない指定) では分かれる', () => {
    expect(clusterUnits('ಕ್‌ಷ')).toEqual(['ಕ್‌', 'ಷ']);
    expect(clusterUnits('க்‌ஷ')).toEqual(['க்‌', 'ஷ']);
    expect(clusterUnits('ਪ੍‌ਰ')).toEqual(['ਪ੍‌', 'ਰ']);
  });
  it('ほかの文字は変わらない (デーヴァナーガリーは GB9c のまま、和文・欧文はまとまらない)', () => {
    expect(clusterUnits('क्षत्रिय')).toEqual(['क्ष', 'त्रि', 'य']);
    expect(clusterUnits('abc あいう')).toBeNull();
  });
});

describe('結合子音が、書体の結合の字形になる (ヴィラーマの字形が残らない)', () => {
  it('カンナダ ಕನ್ನಡ: ನ್ನ は ನ + 下に付く ನ (ヴィラーマの字形は無い)', () => {
    const g = glyphAreas('ಕನ್ನಡ', 'Knda');
    expect(g.map((a) => a.text)).toEqual(['ಕ', 'ನ್ನ', 'ಡ']);
    expect(g[1].glyphIds).toHaveLength(2);
    expect(g[1].glyphIds![0]).toBe(nominal('Knda', 'ನ'));
    expect(g[1].glyphIds).not.toContain(nominal('Knda', '್'));
    // 別々に組んだとき (ನ್ = ヴィラーマつきの字形、ನ) の送りの合計より狭い
    expect(g[1].advance).toBeLessThan(glyphAreas('ನ್', 'Knda')[0].advance + glyphAreas('ನ', 'Knda')[0].advance - 1);
  });
  it('グルムキー ਪ੍ਰ: ਪ + 下に付く ਰ', () => {
    const [a] = glyphAreas('ਪ੍ਰ', 'Guru');
    expect(a.text).toBe('ਪ੍ਰ');
    expect(a.glyphIds).not.toContain(nominal('Guru', '੍'));
    expect(a.glyphIds).not.toContain(nominal('Guru', 'ਰ'));
    expect(a.glyphIds![0]).toBe(nominal('Guru', 'ਪ'));
  });
  it('タミル: க்ஷ と ஸ்ரீ は 1 つの字形 (合字)', () => {
    expect(ids('க்ஷ', 'Taml')).toHaveLength(1);
    expect(ids('ஸ்ரீ', 'Taml')).toHaveLength(1);
    expect(ids('ஶ்ரீ', 'Taml')).toEqual(ids('ஸ்ரீ', 'Taml'));
  });
});

describe('fontkit の整形の補い (fontkitShaping.ts の 5〜10)', () => {
  it('5: 合成済みの字 ড় (U+09DC) を組んだ後でも、ড + ヌクタ + 母音記号 に点線の丸が入らない', () => {
    const circle = nominal('Beng', '◌');
    expect(circle).toBeGreaterThan(0);
    expect(ids('ড়া', 'Beng')).not.toContain(circle);
    // NFC の並び (U+09A1 U+09BC)。前の行で、ヌクタの字形が U+09DC から作られている
    const after = ids('ড়া', 'Beng');
    expect(after).not.toContain(circle);
    expect(after).toEqual([nominal('Beng', 'ড'), nominal('Beng', '়'), nominal('Beng', 'া')]);
    expect(ids('ক়ি', 'Beng')).not.toContain(circle);
  });
  it('6: マラヤーラムの「子音 + ヴィラーマ」(記号の位置の無い規則) が落ちずに組める', () => {
    expect(ids('ട്', 'Mlym')).toEqual([nominal('Mlym', 'ട'), nominal('Mlym', '്')]);
    expect(ids('സ്ത', 'Mlym')).toEqual([nominal('Mlym', 'സ'), nominal('Mlym', '്'), nominal('Mlym', 'ത')]);
    // 語の中でも (കോഴിക്കോട് の最後の ട്)
    const g = glyphAreas('കോഴിക്കോട്', 'Mlym');
    expect(g.map((a) => a.text)).toEqual(['കോ', 'ഴി', 'ക്കോ', 'ട്']);
    expect(g.every((a) => (a.glyphIds?.length ?? 0) > 0)).toBe(true);
  });
  it('7: シンハラの、分かれる母音記号 (කෝ) と「子音 + ヴィラーマ + ZWJ」が落ちずに組める', () => {
    const koo = ids('කෝ', 'Sinh');
    expect(koo).toHaveLength(3);
    expect(koo[0]).toBe(nominal('Sinh', 'ෙ'));
    expect(koo[1]).toBe(nominal('Sinh', 'ක'));
    expect(ids('ක්‍', 'Sinh').every((id) => typeof id === 'number')).toBe(true);
    // 分かれる母音記号の後ろのアヌスヴァーラ: 点線の丸が入らない
    expect(ids('කෝං', 'Sinh')).toEqual([...koo, nominal('Sinh', '\u0d82')]);
    // ラカーランサヤ: ක + 下に付く ර の字形 (ヴィラーマも ර の字形も残らない)
    const kra = ids('ක්‍ර', 'Sinh');
    expect(kra).toHaveLength(2);
    expect(kra[0]).toBe(nominal('Sinh', 'ක'));
    expect(kra).not.toContain(nominal('Sinh', 'ර'));
    expect(ids('ශ්‍රී', 'Sinh')).toHaveLength(2);
  });
  it('7・8: シンハラのレパヤ (ර්‍ + 子音) は、次の子音との 1 つの字形になる。前に置く母音記号は、その前', () => {
    const rka = ids('ර්‍ක', 'Sinh');
    expect(rka).toHaveLength(1);
    expect([nominal('Sinh', 'ර'), nominal('Sinh', 'ක'), nominal('Sinh', '්')]).not.toContain(rka[0]);
    // ධර්‍ම: レパヤは ධ でなく ම に載る
    const g = glyphAreas('ධර්‍ම', 'Sinh');
    expect(g.map((a) => a.text)).toEqual(['ධ', 'ර්‍ම']);
    expect(g[0].glyphIds).toEqual([nominal('Sinh', 'ධ')]);
    expect(g[1].glyphIds).toHaveLength(1);
    expect(ids('ර්‍කෝ', 'Sinh')).toEqual([nominal('Sinh', 'ෙ'), rka[0], koo2()]);
    function koo2() {
      return ids('කෝ', 'Sinh')[2];
    }
  });
  it('9: ベンガルの語の途中の ে は、語頭の形にならない (語頭・空白の後ろ・数字の後ろは語頭の形)', () => {
    const e = nominal('Beng', 'ে');
    // 語頭: 語頭の形 (cmap の字形でない)
    const head = glyphAreas('বে', 'Beng')[0];
    expect(head.glyphIds![0]).not.toBe(e);
    expect(head.glyphIds![1]).toBe(nominal('Beng', 'ব'));
    // 語の途中: 前の字とつながる形 (cmap の字形)
    const g = glyphAreas('তবে বে ১বে', 'Beng');
    expect(g.map((a) => a.text)).toEqual(['ত', 'বে', ' ', 'বে', ' ', '১', 'বে']);
    expect(g[1].glyphIds).toEqual([e, nominal('Beng', 'ব')]);
    expect(g[3].glyphIds).toEqual(head.glyphIds);
    expect(g[6].glyphIds).toEqual(head.glyphIds);
    // ো (ে + া に分かれる) も同じ
    expect(glyphAreas('ভালো', 'Beng')[1].glyphIds![0]).toBe(e);
  });
  it('10: 字形を消す規則のある書体 (Noto Serif Bengali の র্কি) で、番号の無い字形が残らない', () => {
    const g = glyphAreas('কার্তিক', 'BengSerif');
    expect(g.map((a) => a.text)).toEqual(['কা', 'র্তি', 'ক']);
    expect(g[1].glyphIds).toHaveLength(2);
    expect(g[1].glyphIds!.every((id) => typeof id === 'number' && id > 0)).toBe(true);
    expect(g[1].glyphIds![1]).toBe(nominal('BengSerif', 'ত'));
  });
});

describe('字の単位の間の詰め (書体の kern・dist) を、インド系の文字にも当てる', () => {
  it('タミル ன் と னை の間 (Noto Sans Tamil は 31/1000 em 詰める) が、字の位置に入る', () => {
    const k = measurer.clusterKern('ன்', 'னை', { fontFamily: 'Taml', fontWeight: 400 });
    expect(k).toBeCloseTo(-0.031, 6);
    const g = glyphAreas('ன்னை', 'Taml');
    expect(g.map((a) => a.text)).toEqual(['ன்', 'னை']);
    const alone = glyphAreas('ன்', 'Taml')[0].advance;
    expect(g[1].left - g[0].left).toBeCloseTo(alone + k * g[0].fontSize, 6);
    // font-kerning: none では足さない
    const off = glyphAreas('ன்னை', 'Taml', { kerning: false });
    expect(off[1].left - off[0].left).toBeCloseTo(alone, 6);
  });
  it('組の無い並び・別の書体の並びは 0', () => {
    expect(measurer.clusterKern('க', 'க', { fontFamily: 'Taml', fontWeight: 400 })).toBe(0);
    expect(measurer.clusterKern('ன்', 'あ', { fontFamily: 'Taml', fontWeight: 400 })).toBe(0);
  });
});

describe('折り返し・字間', () => {
  it('カンナダの文は空白で折り返す。結合子音の単位の中では分けない', () => {
    const text = 'ನಾನು ಕನ್ನಡ ಮಾತನಾಡುತ್ತೇನೆ ಕರ್ನಾಟಕದ ಜನರು';
    const tree = engine.layout(doc([{ type: 'block', textAlign: 'start', fontFamily: 'Knda', width: 80, children: [text] }] as never));
    const block = tree.sheets[0].page.regionBody.children[0] as unknown as { children: Area[] };
    const lines = block.children.map((line) => {
      const t: string[] = [];
      const visit = (a: Area) => {
        if (a.type === 'glyph') t.push(a.text);
        for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c);
      };
      visit(line);
      return t.join('').trim();
    });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(text);
    for (const l of lines) for (const w of l.split(' ')) expect(text.split(' ')).toContain(w);
  });
  it('字間 (letter-spacing) は、結合子音の単位の中には入らない', () => {
    const g = glyphAreas('ಕನ್ನಡ', 'Knda', { letterSpacing: 5 });
    expect(g.map((a) => a.text)).toEqual(['ಕ', 'ನ್ನ', 'ಡ']);
    expect(g[1].glyphIds).toHaveLength(2);
  });
});
