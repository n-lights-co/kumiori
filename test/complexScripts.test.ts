import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { doc, extraTestFont, fontBuffer, FAMILY } from './helpers';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { complexContextBreaks, lineBreakActions } from '../src/lineBreak';
import { clusterUnits } from '../src/grapheme';
import type { Area, GlyphArea } from '../src/types';

/**
 * タイ文字とデーヴァナーガリーを組む (CSS-10)。
 *  - 書体の整形 (fontkitShaping.ts): デーヴァナーガリーが落ちずに、結合子音・レフ・前に置く母音記号の字形になる。
 *    タイ文字の SARA AM の並べ替え、上に伸びる字の声調記号の字形
 *  - 語の間に空白を書かない用字の改行 (lineBreak.ts の complexContextBreaks): 辞書 (Intl.Segmenter) の語の境目で折り返す。
 *    語の境目そのものは ICU の版で変わりうるので、位置は固定せず「箱に収まる」「字の単位を割らない」「実行環境の辞書の境目と合う」で確かめる
 * 書体: Noto Sans Thai・Noto Sans Devanagari (テストが取得する。helpers.ts の EXTRA_TEST_FONTS)
 */
let fonts: FontManager;
let engine: LayoutEngine;
const buf = async (name: Parameters<typeof extraTestFont>[0]) => {
  const b = fs.readFileSync(await extraTestFont(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  fonts = new FontManager();
  await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
  await fonts.registerBuffer('Thai', 400, await buf('NotoSansThai-Regular-v29.ttf'), false);
  await fonts.registerBuffer('Deva', 400, await buf('NotoSansDevanagari-Regular-v33.ttf'), false);
  engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY });
});
afterEach(() => vi.unstubAllGlobals());

type Line = { texts: string[]; width: number };
/** 幅 width (pt) の箱に組んだ行ごとの字 (GlyphArea の文字列) と、行の中身の幅 */
const linesOf = (text: string, family: string, width: number, extra: object = {}): Line[] => {
  const tree = engine.layout(doc([{ type: 'block', textAlign: 'start', fontFamily: family, width, children: [text], ...extra }] as never));
  const block = tree.sheets[0].page.regionBody.children[0] as unknown as { children: Area[] };
  return block.children.map((line) => {
    const texts: string[] = [];
    let end = 0;
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph') {
        texts.push(a.text);
        if (a.text.trim()) end = Math.max(end, x + (a as GlyphArea).advance);
      }
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
    };
    visit(line, 0);
    return { texts, width: end };
  });
};
const glyphAreas = (text: string, family: string): GlyphArea[] => {
  const out: GlyphArea[] = [];
  const visit = (a: Area) => {
    if (a.type === 'glyph') out.push(a);
    for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c);
  };
  for (const c of engine.layout(doc([{ type: 'block', textAlign: 'start', fontFamily: family, children: [text] }] as never)).sheets[0].page.regionBody.children) visit(c);
  return out;
};
const nominal = (family: string, ch: string) => fonts.get(family, 400).fk.glyphForCodePoint(ch.codePointAt(0)!).id;
const cps = (s: string) => [...s].map((c) => c.codePointAt(0)!);

describe('デーヴァナーガリー: 書体の整形で、音節ごとの字形になる', () => {
  it('組んでも落ちない (regeneratorRuntime が無くても)。大域には何も残さない', () => {
    expect('regeneratorRuntime' in globalThis).toBe(false);
    const g = glyphAreas('हिन्दी', 'Deva');
    expect(g.map((a) => a.text)).toEqual(['हि', 'न्दी']);
    expect(g.every((a) => a.fontFamily === 'Deva' && (a.glyphIds?.length ?? 0) > 0 && !a.glyphIds!.includes(0))).toBe(true);
    expect('regeneratorRuntime' in globalThis).toBe(false);
  });
  it('大域に regeneratorRuntime が既にあれば、それを使い、消さない', () => {
    const mark = vi.fn(<T>(f: T) => f);
    const runtime = {
      mark,
      wrap(inner: (ctx: { prev: number; next: number; stop(): void }) => unknown) {
        let done = false;
        const ctx = { prev: 0, next: 0, stop: () => void (done = true) };
        return {
          next() {
            if (done) return { done: true, value: undefined };
            const value = inner(ctx);
            return done ? { done: true, value: undefined } : { done: false, value };
          },
        };
      },
    };
    vi.stubGlobal('regeneratorRuntime', runtime);
    // ほかのテストで測っていない並び (測った結果は覚えているので)
    expect(glyphAreas('ग्घ', 'Deva')[0].glyphIds?.length).toBeGreaterThan(0);
    expect(mark).toHaveBeenCalled();
    expect((globalThis as { regeneratorRuntime?: unknown }).regeneratorRuntime).toBe(runtime);
  });
  it('結合子音 क्ष (क + ्  + ष) は 1 つの字で、1 つの字形 (どの字の字形でもない合字)', () => {
    const [a] = glyphAreas('क्ष', 'Deva');
    expect(a.text).toBe('क्ष');
    expect(a.glyphIds).toHaveLength(1);
    expect([nominal('Deva', 'क'), nominal('Deva', '्'), nominal('Deva', 'ष')]).not.toContain(a.glyphIds![0]);
  });
  it('前に置く母音記号: कि は、ि の字形が先、क の字形が後', () => {
    const [a] = glyphAreas('कि', 'Deva');
    expect(a.text).toBe('कि');
    expect(a.glyphIds).toHaveLength(2);
    expect(a.glyphIds![1]).toBe(nominal('Deva', 'क'));
    expect(a.glyphIds![0]).not.toBe(nominal('Deva', 'क'));
  });
  it('レフ: र्क (र + ् + क) は、क の字形が先で、上に載る記号 (送り 0) が後', () => {
    const [a] = glyphAreas('र्क', 'Deva');
    expect(a.glyphIds).toHaveLength(2);
    expect(a.glyphIds![0]).toBe(nominal('Deva', 'क'));
    expect(a.glyphPositions![1][0]).toBe(0);
    // 送りは क 1 字分
    expect(a.advance).toBeCloseTo(glyphAreas('क', 'Deva')[0].advance, 6);
  });
  it('ZWJ・ZWNJ で形を切り替える: क्‍ष は半分の形 + ष、क्‌ष は क + 見える virama + ष (どちらも合字にしない)', () => {
    const lig = glyphAreas('क्ष', 'Deva')[0].glyphIds![0];
    const zwj = glyphAreas('क्‍ष', 'Deva').flatMap((a) => a.glyphIds ?? []);
    const zwnj = glyphAreas('क्‌ष', 'Deva').flatMap((a) => a.glyphIds ?? []);
    expect(zwj).not.toContain(lig);
    expect(zwnj).not.toContain(lig);
    expect(zwj).toContain(nominal('Deva', 'ष'));
    expect(zwj).not.toContain(nominal('Deva', 'क'));
    expect(zwnj).toEqual(expect.arrayContaining([nominal('Deva', 'क'), nominal('Deva', '्'), nominal('Deva', 'ष')]));
  });
  it('空白で区切った文は、空白で折り返す (語の途中・字の単位の途中で分けない)', () => {
    const text = 'नमस्ते भारत में आपका स्वागत है यह एक परीक्षण है';
    const ls = linesOf(text, 'Deva', 90);
    expect(ls.length).toBeGreaterThan(1);
    for (const l of ls) expect(l.width).toBeLessThanOrEqual(90 + 1e-6);
    expect(ls.map((l) => l.texts.join('').trim()).join(' ')).toBe(text);
  });
});

describe('タイ文字: 書体の整形', () => {
  const ids = (text: string) => glyphAreas(text, 'Thai').flatMap((a) => a.glyphIds ?? []);
  it('声調記号 + SARA AM (น้ำ) は 1 つの字。丸 (NIKHAHIT) を声調記号の前に並べ替えた字形の並びになる', () => {
    const [a] = glyphAreas('น้ำ', 'Thai');
    expect(a.text).toBe('น้ำ');
    // 並べ替えた並び (น + NIKHAHIT + 声調記号 + SARA AA) を組んだものと同じ字形・同じ位置
    const b = glyphAreas('นํ้า', 'Thai').flatMap((x) => x.glyphIds ?? []);
    expect(a.glyphIds).toEqual(b);
    expect(a.glyphIds![1]).toBe(nominal('Thai', 'ํ'));
    // 丸は基底の字のすぐ上 (上下にずらさない)。声調記号はその後
    expect(a.glyphPositions![1][2]).toBe(0);
  });
  it('上に伸びる字 + 下の母音 + 声調記号 (ปู่) の声調記号は、間に母音が無いとき (ป่) と同じ、左へ寄せた字形になる', () => {
    const direct = ids('ป่');
    const withVowel = ids('ปู่');
    expect(withVowel).toHaveLength(3);
    expect(withVowel[2]).toBe(direct[1]);
    expect(withVowel[2]).not.toBe(nominal('Thai', '่'));
    // 上に伸びない字では、ふつうの字形
    expect(ids('กู่')[2]).toBe(ids('ก่')[1]);
  });
  it('字の文字列 (GlyphArea の text) は、並べ替える前の元の字のまま', () => {
    expect(glyphAreas('กำลัง', 'Thai').map((a) => a.text).join('')).toBe('กำลัง');
  });
});

describe('タイ語: 空白の無い文を、語の境目で折り返す (UAX #14 §5.1 SA・CSS Text 3 §5)', () => {
  const TEXT = 'สวัสดีครับยินดีต้อนรับสู่ประเทศไทยการเรียงพิมพ์ภาษาไทยเป็นเรื่องที่น่าสนใจมาก';
  const W = 75;
  /** 実行環境の辞書の語の境目 (UTF-16 の位置) */
  const boundaries = (text: string) => new Set([...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((s) => s.index));
  const check = (ls: Line[], text: string, w = W) => {
    expect(ls.length).toBeGreaterThan(2);
    for (const l of ls) expect(l.width).toBeLessThanOrEqual(w + 1e-6);
    expect(ls.map((l) => l.texts.join('')).join('')).toBe(text);
    // 字 (GlyphArea) は、どれも字の単位 (書記素クラスタ) の全体: 行の境目は、字の単位の途中に無い
    expect(ls.flatMap((l) => l.texts)).toEqual(clusterUnits(text) ?? [...text]);
  };
  it('箱の幅に収まるように折り返す。行の境目は、字の単位の途中に無く、実行環境の辞書の語の境目にある', () => {
    const b = boundaries(TEXT);
    // 辞書を使わないと (溢れる所で字の単位ごとに分けると)、どれかの幅で語の途中に境目が来る
    for (const w of [60, 75, 90, 100, 120]) {
      const ls = linesOf(TEXT, 'Thai', w);
      check(ls, TEXT, w);
      let pos = 0;
      for (const l of ls.slice(0, -1)) {
        pos += l.texts.join('').length;
        expect(b.has(pos)).toBe(true);
      }
    }
  });
  it('要素の言語 (lang) が無くても・ほかの言語でも、字の用字で分ける', () => {
    check(linesOf(TEXT, 'Thai', W, { language: 'ja' }), TEXT);
    check(linesOf(TEXT, 'Thai', W, { language: 'th' }), TEXT);
    // 正しくない言語の札でも落ちない
    check(linesOf(TEXT, 'Thai', W, { language: '!!' }), TEXT);
  });
  it('word-break: keep-all でも、辞書の語の境目では折り返す (Text 3 §5.2)。break-all は字の単位の間で折り返す', () => {
    const normal = linesOf(TEXT, 'Thai', W);
    expect(linesOf(TEXT, 'Thai', W, { wordBreak: 'keep-all' }).map((l) => l.texts.join(''))).toEqual(normal.map((l) => l.texts.join('')));
    const all = linesOf(TEXT, 'Thai', W, { wordBreak: 'break-all' });
    check(all, TEXT);
    expect(all.length).toBeLessThanOrEqual(normal.length);
    // 語の境目でない所でも折り返している (行に詰められるだけ詰める)
    const b = boundaries(TEXT);
    let pos = 0;
    const ends = all.slice(0, -1).map((l) => (pos += l.texts.join('').length));
    expect(ends.some((e) => !b.has(e))).toBe(true);
  });
  it('white-space: nowrap では折り返さない', () => {
    expect(linesOf(TEXT, 'Thai', W, { noWrap: true })).toHaveLength(1);
  });
  it('空白のある文は、空白でも語の境目でも折り返す。行末の空白は残さない', () => {
    const text = 'กรุงเทพมหานครเป็นเมืองหลวง และเมืองที่มีประชากรมากที่สุด ของประเทศไทย';
    const ls = linesOf(text, 'Thai', W);
    for (const l of ls) expect(l.width).toBeLessThanOrEqual(W + 1e-6);
    expect(ls.map((l) => l.texts.join('')).join('').replace(/ /g, '')).toBe(text.replace(/ /g, ''));
  });
});

describe('語の境目 (complexContextBreaks)', () => {
  it('SA の字を含まない並びでは null を返し、Intl.Segmenter を呼ばない', () => {
    const Seg = vi.fn();
    vi.stubGlobal('Intl', { ...Intl, Segmenter: Seg });
    expect(complexContextBreaks(cps('吾輩は猫である。Hello, world! 한국어 हिन्दी العربية 😀'), () => 'th')).toBeNull();
    expect(Seg).not.toHaveBeenCalled();
  });
  it('境目は、SA の字の並びの中だけ。結合文字の前・並びの端は境目にしない', () => {
    const text = 'abc ภาษาไทยน้ำ def';
    const c = cps(text);
    const out = complexContextBreaks(c, () => undefined) ?? [];
    const start = text.indexOf('ภ');
    const end = text.indexOf(' def');
    for (const k of out) {
      expect(k).toBeGreaterThan(start);
      expect(k).toBeLessThan(end);
      expect(/\p{M}/u.test(String.fromCodePoint(c[k]))).toBe(false);
    }
  });
  it('辞書を持たない SA の用字 (タイ・ルー) は分けない', () => {
    expect(complexContextBreaks(cps('ᦅᧄᦺᦑᦟᦹᧉ'), () => undefined)).toBeNull();
  });
  it('UAX #14 の規則 (lineBreakActions) は、SA の字を AL として扱うまま (字の間に改行の機会を作らない)', () => {
    expect(lineBreakActions(cps('ภาษาไทย')).slice(1)).toEqual(new Array(6).fill('×'));
  });
});

describe('PDF: 字形の並びが字の並びと対応しない字の単位に、元の字の並びを付ける (ActualText)', () => {
  it('कि (字形は ि・क の順) と น้ำ (4 つの字形) に /ActualText が付く。和文・欧文の字には付かない', async () => {
    const { PDFDocument, PDFName, decodePDFRawStream } = await import('pdf-lib');
    const { renderPdf } = await import('../src/pdfRenderer');
    const tree = engine.layout(
      doc([
        { type: 'block', textAlign: 'start', fontFamily: 'Deva', children: ['कि'] },
        { type: 'block', textAlign: 'start', fontFamily: 'Thai', children: ['น้ำ'] },
        { type: 'block', textAlign: 'start', children: ['日本語'] },
      ] as never),
    );
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { subset: false }));
    const ref = pdf.getPages()[0].node.get(PDFName.of('Contents'));
    const st = ([pdf.context.lookup(ref)] as unknown[]).flatMap((o) => ((o as { asArray?: () => unknown[] }).asArray ? (o as { asArray: () => unknown[] }).asArray().map((r) => pdf.context.lookup(r as never)) : [o]));
    const c = st.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as never).decode())).join('\n');
    const utf16 = (s: string) => 'FEFF' + [...s].map((ch) => ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
    expect(c).toContain(`/Span <</ActualText <${utf16('कि')}>>> BDC`);
    expect(c).toContain(`/Span <</ActualText <${utf16('น้ำ')}>>> BDC`);
    // 送りの無い字形 (記号) は、空の文字列を付けた別の印の中
    expect(c).toContain('/Span <</ActualText <FEFF>>> BDC');
    // BDC と EMC は対になっている。和文の字には付けない (上の 2 つの字の単位の分だけ)
    const open = c.match(/ BDC/g)?.length ?? 0;
    expect(open).toBe(c.match(/EMC/g)?.length ?? 0);
    expect(open).toBe(3);
  });
});

describe('HTML・XSL-FO の入力でも同じに組める (同じ組版の道を通る)', () => {
  const TEXT = 'สวัสดีครับยินดีต้อนรับสู่ประเทศไทยการเรียงพิมพ์ภาษาไทยเป็นเรื่องที่น่าสนใจมาก';
  const HINDI = 'हिन्दी क्षत्रिय कि';
  /** 行 (同じ y の字) ごとの文字列と、字の右端の最大 */
  const linesOfTree = (tree: { sheets: Array<{ page: { regionBody: { children: Area[] } } }> }) => {
    const rows = new Map<number, { text: string; left: number; right: number }>();
    const visit = (a: Area, ox: number, oy: number) => {
      const x = ox + a.x;
      const y = oy + a.y;
      if (a.type === 'glyph') {
        const k = Math.round(y * 100);
        const r = rows.get(k) ?? { text: '', left: Infinity, right: -Infinity };
        r.text += a.text;
        r.left = Math.min(r.left, x);
        r.right = Math.max(r.right, x + a.advance);
        rows.set(k, r);
      }
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x, y);
    };
    for (const c of tree.sheets[0].page.regionBody.children) visit(c, 0, 0);
    return [...rows.entries()].sort((p, q) => p[0] - q[0]).map((e) => e[1]);
  };
  const setup = async () => {
    const { typeset, DEFAULT_FONTS } = await import('../src/index');
    const { ensureFonts, loadCachedFont } = await import('./helpers');
    await ensureFonts(DEFAULT_FONTS.base);
    const fontFiles = [
      { name: 'NotoSansThai-Regular.ttf', data: await buf('NotoSansThai-Regular-v29.ttf') },
      { name: 'NotoSansDevanagari-Regular.ttf', data: await buf('NotoSansDevanagari-Regular-v33.ttf') },
    ];
    return (text: string, kind: 'html' | 'fo') => typeset(text, { kind, fonts: fontFiles, loadFont: loadCachedFont, style: 'browser' });
  };
  const checkLines = (rows: Array<{ text: string; left: number; right: number }>, hindiGlyphs: GlyphArea[]) => {
    const thai = rows.filter((r) => /[฀-๿]/.test(r.text));
    // 幅 90pt の箱の中で折り返す (はみ出さない)
    expect(thai.length).toBeGreaterThan(2);
    const left = Math.min(...thai.map((r) => r.left));
    for (const r of thai) expect(r.right - left).toBeLessThanOrEqual(90 + 1e-3);
    expect(thai.map((r) => r.text).join('')).toBe(TEXT);
    const words = new Set([...new Intl.Segmenter('th', { granularity: 'word' }).segment(TEXT)].map((s) => s.index));
    let pos = 0;
    for (const r of thai.slice(0, -1)) expect(words.has((pos += r.text.length))).toBe(true);
    // デーヴァナーガリーは、書体の字形 (結合子音は 1 つの字形、कि は 2 つ) で組まれている
    const byText = new Map(hindiGlyphs.map((g) => [g.text, g]));
    expect(byText.get('क्ष')?.glyphIds).toHaveLength(1);
    expect(byText.get('कि')?.glyphIds).toHaveLength(2);
    expect(byText.get('कि')?.fontFamily).toBe('Noto Sans Devanagari');
  };
  const hindiOf = (tree: { sheets: Array<{ page: { regionBody: { children: Area[] } } }> }) => {
    const out: GlyphArea[] = [];
    const visit = (a: Area) => {
      if (a.type === 'glyph' && /[ऀ-ॿ]/.test(a.text)) out.push(a);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c);
    };
    for (const c of tree.sheets[0].page.regionBody.children) visit(c);
    return out;
  };
  it('HTML: 幅を決めた箱の中のタイ語が語の境目で折り返し、ヒンディー語が書体の字形で組まれる', async () => {
    const run = await setup();
    const r = await run(
      `<!doctype html><html lang="th"><body style="font-family:'Noto Sans Thai','Noto Sans Devanagari';font-size:10pt"><div style="width:90pt">${TEXT}</div><p lang="hi">${HINDI}</p></body></html>`,
      'html',
    );
    checkLines(linesOfTree(r.areaTree as never), hindiOf(r.areaTree as never));
    expect(r.warnings.filter((w) => /描けません|字形/.test(w))).toEqual([]);
  }, 300_000);
  it('XSL-FO: 同じ文が、同じ所で折り返す', async () => {
    const run = await setup();
    const fo =
      `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="th" font-family="'Noto Sans Thai','Noto Sans Devanagari'" font-size="10pt">` +
      `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="150mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
      `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block-container width="90pt"><fo:block>${TEXT}</fo:block></fo:block-container>` +
      `<fo:block xml:lang="hi">${HINDI}</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = await run(fo, 'fo');
    checkLines(linesOfTree(r.areaTree as never), hindiOf(r.areaTree as never));
  }, 300_000);
});
