import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { defaultFontBuffer, doc, extraTestFont, fontBuffer, FAMILY } from './helpers';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { renderSheetToCanvas } from '../src/canvasRenderer';
import { reorderArabicMarks } from '../src/arabicMarks';
import { joiningUnits } from '../src/inlineLayout';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { Area, GlyphArea } from '../src/types';

/**
 * アラビア文字・ヘブライ文字 (右から左の文字) を、実際の書体 (Noto Sans Arabic・Noto Sans Hebrew) で組む。
 * 字形の番号・位置は、同じ書体を HarfBuzz で組んだ結果と照らして確かめた値 (字形の名前) で見る
 */
const ARABIC = 'Noto Sans Arabic';
const HEBREW = 'Noto Sans Hebrew';
let fonts: FontManager;
let engine: LayoutEngine;
const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
beforeAll(async () => {
  fonts = new FontManager();
  await fonts.registerBuffer(FAMILY, 400, await fontBuffer(), false);
  await fonts.registerBuffer('Arimo', 400, await defaultFontBuffer('Arimo-Regular.ttf'), false);
  await fonts.registerBuffer(ARABIC, 400, toAB(fs.readFileSync(await extraTestFont('NotoSansArabic-Regular-v33.ttf'))), false);
  await fonts.registerBuffer(HEBREW, 400, toAB(fs.readFileSync(await extraTestFont('NotoSansHebrew-Regular-v50.ttf'))), false);
  fonts.setLatinFallback(FAMILY, 'Arimo');
  engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY });
});

type WM = 'horizontal-tb' | 'vertical-rl';
const layout = (children: unknown[], extra: object = {}, wm: WM = 'horizontal-tb') => engine.layout(doc([{ type: 'block', textAlign: 'start', fontFamily: ARABIC, children, ...extra }] as never, wm));
const glyphsOf = (children: unknown[], extra: object = {}, wm: WM = 'horizontal-tb') => {
  const out: Array<{ g: GlyphArea; x: number; y: number }> = [];
  const visit = (a: Area, ox: number, oy: number) => {
    const x = ox + a.x;
    const y = oy + a.y;
    if (a.type === 'glyph') out.push({ g: a, x, y });
    for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x, y);
  };
  for (const c of layout(children, extra, wm).sheets[0].page.regionBody.children) visit(c, 0, 0);
  return out;
};
/** 字形の名前 (描く順 = 左から右) */
const names = (g: GlyphArea) => {
  const f = fonts.get(g.fontFamily, g.fontWeight);
  return (g.glyphIds ?? []).map((id) => (f.fk as unknown as { getGlyph(id: number): { name: string } }).getGlyph(id).name);
};

const FATHA = 'َ';
const KASRA = 'ِ';
const DAMMA = 'ُ';
const SHADDA = 'ّ';
const SUKUN = 'ْ';
const HAMZA_ABOVE = 'ٔ';
const HAMZA_BELOW = 'ٕ';
const MADDAH = 'ٓ';
const ZWNJ = '‌';
const LRM = '‎';
const RLM = '‏';

describe('アラビア文字の結合文字の順 (UTR #53 AMTRA)', () => {
  it('シャッダ (ccc 33) を、母音記号 (ccc 27〜32) の前へ出す。正準順 (ファトハ・シャッダ) でも、逆の順でも同じ並びになる', () => {
    expect(reorderArabicMarks(`م${FATHA}${SHADDA}د`)).toBe(`م${SHADDA}${FATHA}د`);
    expect(reorderArabicMarks(`م${SHADDA}${FATHA}د`)).toBe(`م${SHADDA}${FATHA}د`);
    expect(reorderArabicMarks(`ب${KASRA}${SHADDA}`)).toBe(`ب${SHADDA}${KASRA}`);
    // 並べ替えた並びは、元の並びと正準等価
    expect(reorderArabicMarks(`م${FATHA}${SHADDA}د`).normalize('NFC')).toBe(`م${FATHA}${SHADDA}د`.normalize('NFC'));
  });
  it('MCM (ハムザなど) は、ccc 230・220 の並びの先頭にあれば、シャッダより前へ出す (220 の MCM が最も前)', () => {
    // ダンマ (31)・ハムザ上 (230。MCM) → ハムザ上・ダンマ (UTR #53 §4.3 の例 1)
    expect(reorderArabicMarks(`و${DAMMA}${HAMZA_ABOVE}`)).toBe(`و${HAMZA_ABOVE}${DAMMA}`);
    expect(reorderArabicMarks(`ا${KASRA}${HAMZA_BELOW}`)).toBe(`ا${HAMZA_BELOW}${KASRA}`);
    expect(reorderArabicMarks(`ب${SHADDA}${HAMZA_ABOVE}${HAMZA_BELOW}${FATHA}`)).toBe(`ب${HAMZA_BELOW}${HAMZA_ABOVE}${SHADDA}${FATHA}`);
    // ccc 230 の並びが MCM でない字 (マッダ U+0653) で始まれば、その後ろの MCM は動かさない
    expect(reorderArabicMarks(`ا${MADDAH}${HAMZA_ABOVE}${SHADDA}`)).toBe(`ا${SHADDA}${MADDAH}${HAMZA_ABOVE}`);
  });
  it('U+034F (CGJ) で区切った並びは、区切りをまたいで並べ替えない (§4.2)。アラビア文字の結合文字の無い文字列はそのまま', () => {
    expect(reorderArabicMarks(`و${DAMMA}͏${HAMZA_ABOVE}`)).toBe(`و${DAMMA}͏${HAMZA_ABOVE}`);
    expect(reorderArabicMarks('ệ')).toBe('ệ');
    expect(reorderArabicMarks(`ب${FATHA}${SUKUN}`)).toBe(`ب${FATHA}${SUKUN}`);
  });
  it('組んだ結果: ファトハはシャッダの上に載る (シャッダを先に書体へ渡す)。カスラとシャッダは、書体の合字の字形になる', () => {
    const [{ g }] = glyphsOf([`مح${FATHA}${SHADDA}د`]);
    expect(g.text).toBe(`مح${SHADDA}${FATHA}د`);
    const n = names(g);
    // 描く順は左から右 (字の順の逆): …ファトハ・シャッダ・ح…
    const iS = n.indexOf('uni0651');
    const iF = n.indexOf('uni064E');
    expect(iF).toBe(iS - 1);
    // ファトハの方が上 (yOffset が大きい)
    expect(g.glyphPositions![iF][2]).toBeGreaterThan(g.glyphPositions![iS][2]);
    expect(names(glyphsOf([`بب${KASRA}${SHADDA}`])[0].g)).toContain('uni06510650');
  });
});

describe('アラビア文字の字形 (語頭・語中・語尾・独立形、必須の合字、ペルシャ語)', () => {
  it('語は 1 つの字 (GlyphArea) になり、字形は位置で変わる。ラーム・アリフは必須の合字の形', () => {
    const [{ g }] = glyphsOf(['ببب']);
    // 点は別の字形 (dotbelowar)。胴は左から 語尾形・語中形・語頭形
    expect(names(g).filter((x) => x !== 'dotbelowar')).toEqual(['uni066E.fina', 'uni066E.medi', 'uni066E.init']);
    expect(names(glyphsOf(['لا'])[0].g)).toEqual(['uni0627.fina.rlig', 'uni0644.init.rlig']);
  });
  it('ゼロ幅非接合子 (U+200C) は語を分けない: 1 つの字として書体に渡し、前後はつながらない形になり、幅を持たない', () => {
    const word = `می${ZWNJ}خواهم`;
    const gs = glyphsOf([word]);
    expect(gs.map((e) => e.g.text)).toEqual([word]);
    const n = names(gs[0].g);
    // می は 語頭形 + 語尾形、خواهم は خ の語頭形から始まる (ZWNJ の前後でつながらない)
    expect(n).toContain('uni0649.fina');
    expect(n).toContain('uni062D.init');
    // 幅は، ZWNJ の無い 2 つの語の幅の合計
    const w = (s: string) => glyphsOf([s])[0].g.advance;
    expect(gs[0].g.advance).toBeCloseTo(w('می') + w('خواهم'), 6);
  });
  it('joiningUnits: つながる字の間の ZWNJ は並びに入れる。後ろにつながる字が無い ZWNJ・書体が違うときは入れない', () => {
    const units = (s: string, same = true) => joiningUnits([...s], () => same);
    expect(units(`می${ZWNJ}خواهم`)).toEqual([`می${ZWNJ}خواهم`]);
    expect(units(`می${ZWNJ} a`)).toEqual(['می', ZWNJ, ' ', 'a']);
    expect(units(`می${ZWNJ}خو`, false)).toEqual(['م', 'ی', ZWNJ, 'خ', 'و']);
  });
});

describe('ヘブライ文字の記号の位置 (fontkit の文脈の規則の補い。src/fontkitShaping.ts)', () => {
  it('Tinos: 母音記号とカンティレーションが 1 つの字に付くとき、前の文脈が 2 字形の規則で互いによける (HarfBuzz と同じ位置)', async () => {
    const f = new FontManager();
    await f.registerBuffer('Tinos', 400, await defaultFontBuffer('Tinos-Regular.ttf'), false);
    const fk = f.get('Tinos', 400).fk;
    // וְאֵ֥ת: 描く順は ת・メルカー (U+05A5)・ツェレ・א・シュヴァ・ו
    const run = fk.layout('וְאֵ֥ת', { kern: false, liga: false, clig: false } as never);
    expect(run.glyphs.map((x) => (x as unknown as { name: string }).name)).toEqual(['tav', 'uni05A5', 'tsere', 'alef', 'sheva', 'vav']);
    expect(run.positions.map((x) => x.xOffset)).toEqual([0, 340, 840, 0, 0, 0]);
  });
});

describe('単独の描かない字 (LRM・RLM・ZWNJ など) は幅 0 で、字形を描かない', () => {
  it('欧文・和文・ヘブライ文字の中の LRM・RLM・WJ: 前後の字の位置は、その字が無いときと同じ。字 (GlyphArea) も作らない', () => {
    const xs = (s: string, family = FAMILY) => glyphsOf([s], { fontFamily: family }).map((e) => [e.g.text, Math.round(e.x * 1000)]);
    for (const c of [LRM, RLM, '⁠', '؜']) {
      expect(xs(`ab${c}cd`)).toEqual(xs('abcd'));
      expect(xs(`日本${c}語`)).toEqual(xs('日本語'));
    }
    expect(xs(`אב${RLM}גד`, HEBREW)).toEqual(xs('אבגד', HEBREW));
  });
  it('LRM・RLM は、双方向の並べ替えには加わる (数字の後ろの RLM で、後ろの記号が右から左の並びに入る)', () => {
    const order = (s: string) => glyphsOf([s], { fontFamily: HEBREW }).sort((a, b) => a.x - b.x).map((e) => e.g.text).join('');
    // 左から右の段落: 「אב!」の ! は、後ろに強い字が無いので段落の向き (右端)。RLM を後ろに置くと、右から左の並びの中 (左端) になる
    expect(order('אב!')).toBe('בא!');
    expect(order(`אב!${RLM}`)).toBe('!בא');
  });
});

describe('縦書きの中のアラビア文字', () => {
  it('横倒しで組むとき (既定の mixed): 語を 1 つの並びとしてつなげて組み、90° 回す', () => {
    const gs = glyphsOf(['縦ببب'], {}, 'vertical-rl').filter((e) => e.g.text !== '縦');
    expect(gs.length).toBe(1);
    expect(gs[0].g.rotation).toBe(90);
    expect(names(gs[0].g).filter((x) => x !== 'dotbelowar')).toEqual(['uni066E.fina', 'uni066E.medi', 'uni066E.init']);
  });
  it('正立で組むとき (text-orientation: upright): 1 字ずつ独立形で組む (Writing Modes 3 §5.1.1)', () => {
    const gs = glyphsOf(['ببب'], { textOrientation: 'upright' }, 'vertical-rl');
    expect(gs.length).toBe(3);
    expect(gs.every((e) => e.g.rotation === 0)).toBe(true);
  });
});

describe('PDF からの字の取り出し (右から左の文字)', () => {
  const contentOf = async (children: unknown[], extra: object = {}) => {
    const { renderPdf } = await import('../src/pdfRenderer');
    const tree = layout(children, extra);
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts));
    const ref = pdf.getPages()[0].node.get(PDFName.of('Contents'));
    const st = ([pdf.context.lookup(ref)] as unknown[]).flatMap((o) => ((o as { asArray?: () => unknown[] }).asArray ? (o as { asArray: () => unknown[] }).asArray().map((r) => pdf.context.lookup(r as never)) : [o]));
    return { tree, pdf, content: st.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as never).decode())).join('\n') };
  };
  const utf16 = (s: string) => 'FEFF' + Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join('');
  const reversed = (s: string) => [...s].reverse().join('');

  it('字形ごとの字 (ToUnicode): 字形は描く順 (左から右) で、字はその字形が表す字。分けて描く点の字形は字を持たない', async () => {
    const [{ g }] = glyphsOf([`بت${FATHA}`]);
    expect(names(g)).toEqual(['uni064E', 'twodotshorizontalabovear', 'uni066E.fina', 'dotbelowar', 'uni066E.init']);
    // 胴の字形 (語尾形・語頭形) は別の字形なので、ت・ب がそれぞれ登録される。Area Tree には字形ごとの字を持たせない
    const { pdf } = await contentOf([`بت${FATHA}`]);
    const cmaps = pdf.context.enumerateIndirectObjects().map(([, o]) => o).filter((o) => o instanceof PDFRawStream).map((o) => new TextDecoder('latin1').decode(decodePDFRawStream(o as never).decode())).filter((t) => t.includes('beginbfchar'));
    const mapped = cmaps.join('\n').match(/<[0-9A-F]{4}> <([0-9A-F]+)>/g)!.map((x) => x.split(' ')[1]);
    expect(mapped.sort()).toEqual(['<0628>', '<062A>', '<064E>']);
  });
  it('アラビア文字の語は、語ごとに ActualText で字を与える (字は描く順 = 逆順。字を取り出す側が読む順に直す)', async () => {
    const { content } = await contentOf(['كتاب بلا']);
    expect(content).toContain(`/Span <</ActualText <${utf16(reversed('كتاب'))}>>> BDC`);
    expect(content).toContain(`/Span <</ActualText <${utf16(reversed('بلا'))}>>> BDC`);
    // 語ごとに、送りのある字形の区切り (語の字) と、送りの無い字形 (点) の区切り (空の ActualText) の 2 つ
    expect(content.match(/BDC/g)!.length).toBe(4);
    expect(content.match(/<<\/ActualText <FEFF>>> BDC/g)!.length).toBe(2);
    expect(content.match(/EMC/g)!.length).toBe(4);
  });
  it('ヘブライ文字: 記号の無い字は 1 字 1 字形でそのまま書き、母音記号の付いた字 (クラスタ) は ActualText で字を与える', async () => {
    const { content } = await contentOf(['אבּג'], { fontFamily: HEBREW });
    // 送りのある字形 (ב) の区切りに字の並び、送りの無い字形 (ダゲシュ) は空の ActualText の区切り (区切りの範囲が ב の幅になる)
    expect(content.match(/BDC/g)!.length).toBe(2);
    expect(content).toContain(`/Span <</ActualText <${utf16(reversed('בּ'))}>>> BDC`);
    expect(content).toContain('/Span <</ActualText <FEFF>>> BDC');
  });
  it('同じ字形を別の字に使うとき (ی の単独形は ى と同じ字形): 字形に登録された字と違えば ActualText で字を与える', async () => {
    const f = fonts.get(ARABIC, 400);
    expect(f.fk.layout('ی').glyphs.map((x) => x.id)).toEqual(f.fk.layout('ى').glyphs.map((x) => x.id));
    const { content } = await contentOf(['ى ی']);
    expect(content.match(/BDC/g)!.length).toBe(1);
    expect(content).toContain(`/Span <</ActualText <${utf16('ی')}>>> BDC`);
  });
  it('左から右の文字のクラスタ (q + U+0301) には ActualText を付けない (これまでと同じ)', async () => {
    const { content } = await contentOf(['q\u0301x'], { fontFamily: 'Arimo' });
    expect(content).not.toContain('BDC');
  });
});

describe('Canvas の輪郭の描画 (右から左のクラスタ)', () => {
  const draw = (children: unknown[], extra: object = {}) => {
    const calls: Array<[string, ...unknown[]]> = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (typeof k === 'string' ? (...args: unknown[]) => void calls.push([k, ...args]) : undefined),
      set: () => true,
    });
    const had = 'Path2D' in globalThis;
    if (!had) (globalThis as Record<string, unknown>).Path2D = class { constructor(public d: string) {} };
    try {
      renderSheetToCanvas(layout(children, extra).sheets[0], { getContext: () => ctx, style: {} } as unknown as HTMLCanvasElement, fonts, { glyphOutlines: true, scale: 1, devicePixelRatio: 1 });
    } finally {
      if (!had) delete (globalThis as Record<string, unknown>).Path2D;
    }
    return calls;
  };
  it('描く順の最初の字形 (最後の字の記号) も、書体の位置合わせのずらしの位置に描く (PDF と同じ)', () => {
    // ヘブライ文字の ב + ダゲシュ: 描く順は ダゲシュ・ב。ダゲシュは ב の送りの中へずらして置く
    const f = fonts.get(HEBREW, 400);
    const text = 'בּ';
    const calls = draw([text], { fontFamily: HEBREW });
    const fills = calls.map((c, k) => (c[0] === 'fill' ? k : -1)).filter((k) => k >= 0);
    expect(fills.length).toBe(2);
    const at = fills.map((k) => calls[k - 2]);
    const pos = f.fk.layout(text, { kern: false, liga: false, clig: false } as never).positions;
    const k = 10 / f.unitsPerEm;
    expect(pos[0].xOffset).not.toBe(0);
    expect(at[0][1] as number).toBeCloseTo(pos[0].xOffset * k, 6);
    expect(at[1][1] as number).toBeCloseTo((pos[0].xAdvance + pos[1].xOffset) * k, 6);
  });
});
