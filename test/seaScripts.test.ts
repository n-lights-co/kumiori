import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { doc, extraTestFont, fontBuffer, FAMILY } from './helpers';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { reorderMyanmar } from '../src/fontkitShaping';
import { clusterUnits, graphemeClusters } from '../src/grapheme';
import type { Area, GlyphArea, WritingMode } from '../src/types';

/**
 * ラオ文字・クメール文字・ミャンマー文字・チベット文字・モンゴル文字を組む。
 *  - 書体の整形 (fontkitShaping.ts): 字形の番号と位置が、HarfBuzz (uharfbuzz 0.x・同じ書体) の結果と合う。期待値は HarfBuzz で取った値
 *  - 字の単位 (orthographicSyllable.ts): ミャンマー文字・ラオ文字は、書体がクラスタをまたいで字形を決める並びを 1 つの単位にする
 *  - 改行: 空白の無い文を、辞書 (Intl.Segmenter) の語の境目で折り返す。チベット文字は、ツェク (U+0F0B) の後ろで折り返す (UAX #14 の BA)
 *  - PDF: 字の単位に、元の字の並び (ActualText) を付ける
 * 書体: Noto Sans Lao・Noto Sans Khmer・Noto Sans Myanmar・Noto Serif Tibetan・Noto Sans Mongolian (テストが取得する。helpers.ts の EXTRA_TEST_FONTS)
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
  await fonts.registerBuffer('Lao', 400, await buf('NotoSansLao-Regular-v33.ttf'), false);
  await fonts.registerBuffer('Khmer', 400, await buf('NotoSansKhmer-Regular-v29.ttf'), false);
  await fonts.registerBuffer('Myanmar', 400, await buf('NotoSansMyanmar-Regular-v27.ttf'), false);
  await fonts.registerBuffer('Tibetan', 400, await buf('NotoSerifTibetan-Regular-v24.ttf'), false);
  await fonts.registerBuffer('Mongolian', 400, await buf('NotoSansMongolian-Regular-v23.ttf'), false);
  engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: FAMILY });
});

/** 字 (GlyphArea) と、その行の中での位置 x (pt) */
const glyphAreas = (text: string, family: string, extra: object = {}, wm: WritingMode = 'horizontal-tb'): Array<GlyphArea & { at: number }> => {
  const out: Array<GlyphArea & { at: number }> = [];
  const visit = (a: Area, ox: number, oy: number) => {
    if (a.type === 'glyph') out.push({ ...a, at: wm === 'horizontal-tb' ? ox + a.x : oy + a.y });
    for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, ox + a.x, oy + a.y);
  };
  for (const c of engine.layout(doc([{ type: 'block', textAlign: 'start', fontFamily: family, kerning: true, children: [text], ...extra }] as never, wm)).sheets[0].page.regionBody.children) visit(c, 0, 0);
  return out;
};
/**
 * 文字列を組んだ字形の番号と、行の先頭からの位置 (書体の単位。字の大きさ 10pt・1000 単位/em)。HarfBuzz の「字形の番号・ペンの位置 + x のずらし」と比べる。
 * 同じ位置に重なる字形の順は問わないので、(位置, 番号) の順に並べる
 */
const shaped = (text: string, family: string, extra: object = {}): Array<[number, number]> => {
  const upm = fonts.get(family, 400).unitsPerEm;
  const out: Array<[number, number]> = [];
  for (const g of glyphAreas(text, family, extra)) {
    const x0 = (g.at * upm) / 10;
    let pen = 0;
    g.glyphIds!.forEach((id, i) => {
      const p = g.glyphPositions?.[i] ?? [fonts.get(family, 400).fk.getGlyph(id).advanceWidth, 0, 0];
      out.push([id, Math.round(x0 + pen + p[1])]);
      pen += p[0];
    });
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
};
/** HarfBuzz の結果 (字形の番号の並びと位置の並び) を、shaped と同じ形にする */
const hb = (ids: number[], xs: number[]): Array<[number, number]> => ids.map((id, i) => [id, xs[i]] as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const texts = (text: string, family: string, extra: object = {}) => glyphAreas(text, family, extra).map((g) => g.text);

type Line = { texts: string[]; width: number };
const linesOf = (text: string, family: string, width: number, extra: object = {}): Line[] => {
  const tree = engine.layout(doc([{ type: 'block', textAlign: 'start', fontFamily: family, width, children: [text], ...extra }] as never));
  const block = tree.sheets[0].page.regionBody.children[0] as unknown as { children: Area[] };
  return block.children.map((line) => {
    const ts: string[] = [];
    let end = 0;
    const visit = (a: Area, ox: number) => {
      const x = ox + a.x;
      if (a.type === 'glyph') {
        ts.push(a.text);
        if (a.text.trim()) end = Math.max(end, x + (a as GlyphArea).advance);
      }
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, x);
    };
    visit(line, 0);
    return { texts: ts, width: end };
  });
};

describe('ラオ文字: 書体の整形と字の単位', () => {
  it('SARA AM (U+0EB3) を NIGGAHITA と AA に分け、声調記号の前へ並べ替える (Microsoft の Lao の整形の文書の Analyze Characters)', () => {
    // HarfBuzz: ນ + (NIGGAHITA と声調記号の合字) + າ
    expect(shaped('ນ້ຳ', 'Lao')).toEqual(hb([30, 108, 59], [0, 280, 614]));
    // 2 字で書いた並び (NIGGAHITA + 声調記号 + AA) も、同じ字形 (NIGGAHITA のあるクラスタと、後ろの AA を 1 つの単位にする)
    expect(texts('ນໍ້າ', 'Lao')).toEqual(['ນໍ້າ']);
    expect(shaped('ນໍ້າ', 'Lao')).toEqual(hb([30, 108, 59], [0, 280, 614]));
    // 字の文字列は元のまま
    expect(texts('ນ້ຳ', 'Lao')).toEqual(['ນ້ຳ']);
  });
  it('上に伸びる字 + 下の母音 + 声調記号: 声調記号が、左へ寄せた字形になる (記号を選んで飛ばす指定・前の文脈の順)', () => {
    expect(shaped('ປູ່', 'Lao')).toEqual(hb([32, 77, 89], [0, 175, 186]));
    expect(shaped('ກູ່', 'Lao')).toEqual(hb([9, 77, 88], [0, 183, 384]));
  });
  it('前に置く母音 (U+0EC0〜0EC4) と次の子音のクラスタは、1 つの単位: 子音の上の記号の字形と、母音と子音の間の詰めが、書体のとおりになる', () => {
    expect(texts('ເຈັດ', 'Lao')).toEqual(['ເຈັ', 'ດ']);
    expect(shaped('ເຈັດ', 'Lao')).toEqual(hb([80, 14, 62, 25], [0, 251, 262, 817]));
    // 前に置く母音が無いと、記号は別の字形 (62 でなく 60)
    expect(shaped('ຈັດ', 'Lao')).toEqual(hb([14, 60, 25], [0, 162, 566]));
    // 単位の間の詰め (ໃ と ຈ は 1 つの単位、その前後は基底の字の組) も、HarfBuzz の位置と合う
    expect(shaped('ຂອບໃຈ', 'Lao')).toEqual(hb([10, 48, 31, 83, 14], [0, 615, 1235, 1849, 2099]));
    // SARA AM を分けた AA と子音の間の詰め
    expect(shaped('ຈຳ', 'Lao')).toEqual(hb([14, 86, 59], [0, 259, 536]));
  });
  it('字間 (letter-spacing) があるときは、前に置く母音と子音をまとめない (字間は書記素クラスタの間に空ける)', () => {
    expect(texts('ເຈັດ', 'Lao', { letterSpacing: 2 })).toEqual(['ເ', 'ຈັ', 'ດ']);
    const g = glyphAreas('ເຈັດ', 'Lao', { letterSpacing: 2 });
    // ເ の送り 2.81pt + 字間 2pt。ເ と ຈ の間の詰め (−0.3pt) は、単位の間の詰めとして残る (HarfBuzz: ຈ は 251 から)
    expect(g[1].at - g[0].at).toBeCloseTo(2.81 + 2 - 0.3, 6);
  });
  it('font-kerning が無効なら、単位の中も詰めない', () => {
    const on = glyphAreas('ໃຈ', 'Lao')[0];
    const off = glyphAreas('ໃຈ', 'Lao', { kerning: false })[0];
    expect(on.text).toBe('ໃຈ');
    // HarfBuzz: ໃ と ຈ の間の詰めは −30 (書体の単位)
    expect(off.advance - on.advance).toBeCloseTo(0.3, 6);
  });
});

describe('クメール文字: 書体の整形', () => {
  it('子音と母音記号 AA の合字 (clig。クメール文字の整形に必須の機能) は、合字の指定・字間によらず当たる', () => {
    expect(shaped('បា', 'Khmer')).toEqual(hb([278], [0]));
    expect(shaped('បា', 'Khmer', { latinLigatures: false })).toEqual(hb([278], [0]));
    expect(glyphAreas('បា', 'Khmer', { letterSpacing: 1 })[0].glyphIds).toEqual([278]);
    // 縦書き (字は横倒し) でも同じ字形
    expect(glyphAreas('បា', 'Khmer', {}, 'vertical-rl')[0].glyphIds).toEqual([278]);
  });
  it('アンカーの無い組のある記号 (NIKAHIT U+17C6) を組んでも落ちず、基底の字の上に載る', () => {
    expect(shaped('កំ', 'Khmer')).toEqual(hb([49, 137], [0, 613]));
    expect(shaped('ខ្ញុំ', 'Khmer')).toEqual(hb([50, 194, 115, 137], [0, 631, 624, 615]));
  });
  it('下に付く子音 (COENG U+17D2)・前に置く母音・囲む母音: 音節は 1 つの単位 (UAX #29) で、字形は HarfBuzz と合う', () => {
    expect(texts('ស្ត្រី', 'Khmer')).toEqual(['ស្ត្រី']);
    expect(shaped('ស្ត្រី', 'Khmer')).toEqual(hb([220, 83, 204, 109], [0, 287, 1229, 1183]));
    expect(shaped('ស្រុក', 'Khmer')).toEqual(hb([220, 83, 116, 49], [0, 287, 1358, 1215]));
    expect(shaped('កៅ', 'Khmer')).toEqual(hb([131, 237], [0, 288]));
  });
});

describe('ミャンマー文字: 並べ替え・書体の整形・字の単位', () => {
  it('音節の中の字を、書体に渡す順に並べ替える (Microsoft の Myanmar の整形の文書の Reordering characters の例)', () => {
    const input = [0x1004, 0x103a, 0x1039, 0x1000, 0x1039, 0x1000, 0x103b, 0x103c, 0x103d, 0x1031, 0x1031, 0x102d, 0x102f, 0x1036, 0x102c, 0x1036];
    const reordered = [0x1031, 0x1031, 0x103c, 0x1000, 0x1004, 0x103a, 0x1039, 0x1039, 0x1000, 0x103b, 0x103d, 0x102d, 0x1036, 0x102f, 0x102c, 0x1036];
    expect([...reorderMyanmar(String.fromCharCode(...input))].map((c) => c.charCodeAt(0))).toEqual(reordered);
    // ミャンマー文字でない字・基底の字の無い記号は、そのまま
    expect(reorderMyanmar('abc ေ က')).toBe('abc ေ က');
    // 音節ごと: 前に置く母音記号は、その音節の基底の字の前へ
    expect(reorderMyanmar('နေကောင်း')).toBe('ေနေကာင်း');
  });
  it('前に置く母音記号・メディアルの RA・キンジ・積み重ねの字形が、HarfBuzz と合う', () => {
    expect(shaped('မြန်မာ', 'Myanmar')).toEqual(hb([47, 29, 24, 381, 29, 368], [0, 229, 905, 1518, 1475, 2151]));
    expect(shaped('ကျောင်း', 'Myanmar')).toEqual(hb([372, 4, 382, 368, 8, 381, 379], [0, 618, 1742, 1999, 2454, 3097, 3104]));
    expect(shaped('သင်္ဘော', 'Myanmar')).toEqual(hb([34, 372, 28, 189, 368], [0, 1127, 1745, 2858, 2869]));
    // 下の母音記号の後ろのアヌスヴァーラは、前へ
    expect(shaped('ကုံ', 'Myanmar')).toEqual(hb([4, 377, 209], [0, 1097, 1119]));
  });
  it('音節 (子音 + 記号 + 末子音・積み重ね) は 1 つの単位: 語の中の積み重ねの前に、語頭用の空きの字形が入らない', () => {
    expect(texts('မြန်မာ', 'Myanmar')).toEqual(['မြန်', 'မာ']);
    expect(texts('ကျောင်း', 'Myanmar')).toEqual(['ကျောင်း']);
    expect(texts('ကမ္ဘာ', 'Myanmar')).toEqual(['ကမ္ဘာ']);
    expect(texts('မင်္ဂလာပါ', 'Myanmar')).toEqual(['မင်္ဂ', 'လာ', 'ပါ']);
    expect(shaped('ကမ္ဘာ', 'Myanmar')).toEqual(hb([4, 29, 271, 368], [0, 1124, 1782, 1800]));
    // UAX #29 の書記素クラスタそのもの (graphemeClusters) は変えない
    expect(graphemeClusters('ကမ္ဘာ')).toEqual(['က', 'မ္ဘ', 'ာ']);
    // 数字・句読点・ほかの用字の字とは、まとめない
    expect(clusterUnits('၁၂ကာ။aာ')).toEqual(['၁', '၂', 'ကာ', '။', 'a', 'ာ']);
  });
  it('字形を増やす置き換え (字形の前に空きの字形を入れる規則) で止まらない', () => {
    const g = glyphAreas('မွှ', 'Myanmar')[0];
    expect(g.glyphIds).toEqual([594, 29, 362]);
  });
});

describe('チベット文字', () => {
  it('積み重ね (下に付く子音 U+0F90〜0FBC) は 1 つの単位で、書体の合字の字形になる', () => {
    expect(texts('བསྒྲུབས', 'Tibetan')).toEqual(['བ', 'སྒྲུ', 'བ', 'ས']);
    expect(shaped('བསྒྲུབས', 'Tibetan')).toEqual(hb([27, 1103, 27, 43], [0, 641, 1316, 1957]));
  });
  it('字の組の詰め: 積み重ねの単位とツェクの間・ツェクと次の字の間を、単位のまま書体に渡して引く', () => {
    // HarfBuzz: རྒྱ (送り 704) の後ろのツェクは 674 から (−30)、ツェク (210) の後ろの ན は 884 から
    expect(shaped('རྒྱ་ནག', 'Tibetan')).toEqual(hb([849, 1261, 24, 8], [0, 674, 884, 1551]));
  });
  it('ツェク (U+0F0B) の後ろで折り返す。ツェクの前・音節の途中では折り返さない', () => {
    const text = 'བོད་ནི་རི་མཐོ་ཞིང་གངས་རི་མང་བའི་ས་ཆ་ཞིག་ཡིན།';
    const ls = linesOf(text, 'Tibetan', 60);
    expect(ls.length).toBeGreaterThan(2);
    for (const l of ls) expect(l.width).toBeLessThanOrEqual(60 + 1e-6);
    expect(ls.map((l) => l.texts.join('')).join('')).toBe(text);
    for (const l of ls.slice(0, -1)) expect(l.texts[l.texts.length - 1]).toBe('་');
  });
});

describe('モンゴル文字 (Noto Sans Mongolian: fontkit が読めない Lookup を持つ書体)', () => {
  it('読めない Lookup (GSUB の種類 8) があっても、その書体で組める (欧字も)', () => {
    expect(shaped('abc', 'Mongolian')).toEqual(hb([1705, 1723, 1733], [0, 561, 1176]));
  });
  it('語は 1 つの単位で、語頭・語中・語尾の形になる (HarfBuzz と同じ字形)', () => {
    const g = glyphAreas('ᠮᠣᠩᠭᠣᠯ', 'Mongolian');
    expect(g.map((a) => a.text)).toEqual(['ᠮᠣᠩᠭᠣᠯ']);
    expect(g[0].glyphIds).toEqual([121, 32, 1298, 32, 129]);
    expect(g[0].advance).toBeCloseTo(31.63, 6);
  });
  it('母音分離子 (MVS U+180E)・接尾辞の前の NNBSP (U+202F) は、語の単位に含める (前後の字の形を、書体が決める)', () => {
    const mvs = glyphAreas('ᠮᠣᠩᠭᠣᠯ᠎ᠠ', 'Mongolian');
    expect(mvs.map((a) => a.text)).toEqual(['ᠮᠣᠩᠭᠣᠯ᠎ᠠ']);
    // 字の字形は HarfBuzz と同じ (MVS の字形は、fontkit が幅の無い字形にする。HarfBuzz は 1478)
    expect(mvs[0].glyphIds!.filter((_, i) => i !== 5)).toEqual([121, 32, 1298, 32, 129, 7]);
    const nnbsp = glyphAreas('ᠠᠬ᠎ᠠ ᠶᠢᠨ', 'Mongolian');
    expect(nnbsp.map((a) => a.text)).toEqual(['ᠠᠬ᠎ᠠ ᠶᠢᠨ']);
    expect(nnbsp[0].glyphIds!.filter((_, i) => i !== 2)).toEqual([8, 103, 7, 1480, 169, 26, 76]);
  });
  it('縦書き (vertical-lr・vertical-rl) でも、語は 1 つの単位でつながる (字は横倒し)', () => {
    for (const wm of ['vertical-lr', 'vertical-rl'] as const) {
      const g = glyphAreas('ᠮᠣᠩᠭᠣᠯ ᠪᠢᠴᠢᠭ', 'Mongolian', {}, wm).filter((a) => a.text.trim());
      expect(g.map((a) => a.text)).toEqual(['ᠮᠣᠩᠭᠣᠯ', 'ᠪᠢᠴᠢᠭ']);
      expect(g[0].glyphIds).toEqual([121, 32, 1298, 32, 129]);
      expect(g[0].rotation).toBe(90);
      // 2 つ目の語は、1 つ目の語の送りと空白の分だけ下
      expect(g[1].at - g[0].at).toBeGreaterThan(31.63);
    }
  });
});

describe('空白の無い文を、語の境目で折り返す (ラオ・クメール・ミャンマー。UAX #14 §5.1 SA・CSS Text 3 §5)', () => {
  const CASES: Array<[string, string, string]> = [
    ['lo', 'Lao', 'ນັກຮຽນໄປໂຮງຮຽນທຸກມື້ເພື່ອຮຽນພາສາລາວແລະຄະນິດສາດຢ່າງຕັ້ງໃຈ'],
    ['km', 'Khmer', 'សិស្សទៅសាលារៀនរាល់ថ្ងៃដើម្បីរៀនភាសាខ្មែរនិងគណិតវិទ្យាយ៉ាងយកចិត្តទុកដាក់'],
    ['my', 'Myanmar', 'ကျောင်းသားများသည်မြန်မာစာနှင့်သင်္ချာကိုသင်ယူရန်နေ့စဉ်ကျောင်းသို့သွားကြသည်'],
  ];
  for (const [lang, family, text] of CASES) {
    it(`${lang}: 箱の幅に収まり、行の境目は字の単位の途中に無く、実行環境の辞書の語の境目にある`, () => {
      const b = new Set([...new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)].map((s) => s.index));
      // この実行環境の辞書が、この用字の語を分ける (分けない環境では、折り返さずにはみ出す。これまでと同じ)
      expect(b.size).toBeGreaterThan(5);
      for (const w of [70, 90, 120]) {
        const ls = linesOf(text, family, w);
        expect(ls.length).toBeGreaterThan(1);
        for (const l of ls) expect(l.width).toBeLessThanOrEqual(w + 1e-6);
        expect(ls.map((l) => l.texts.join('')).join('')).toBe(text);
        expect(ls.flatMap((l) => l.texts)).toEqual(clusterUnits(text) ?? [...text]);
        let pos = 0;
        for (const l of ls.slice(0, -1)) {
          pos += l.texts.join('').length;
          expect(b.has(pos)).toBe(true);
        }
      }
    });
  }
  it('ゼロ幅空白 (U+200B) を語の区切りに入れた文は、そこでも折り返せる', () => {
    const text = 'សិស្ស​ទៅ​សាលារៀន​រាល់​ថ្ងៃ​ដើម្បី​រៀន';
    const ls = linesOf(text, 'Khmer', 50);
    expect(ls.length).toBeGreaterThan(1);
    for (const l of ls) expect(l.width).toBeLessThanOrEqual(50 + 1e-6);
    expect(ls.map((l) => l.texts.join('')).join('')).toBe(text.replace(/​/g, ''));
  });
});

describe('PDF: 字の単位に、元の字の並びを付ける (ActualText)', () => {
  it('前に置く母音記号・メディアルの RA で字形の順が変わる単位に /ActualText が付く', async () => {
    const { PDFDocument, PDFName, decodePDFRawStream } = await import('pdf-lib');
    const { renderPdf } = await import('../src/pdfRenderer');
    const tree = engine.layout(
      doc([
        { type: 'block', textAlign: 'start', fontFamily: 'Myanmar', children: ['မြေ'] },
        { type: 'block', textAlign: 'start', fontFamily: 'Khmer', children: ['កៅ'] },
        { type: 'block', textAlign: 'start', fontFamily: 'Lao', children: ['ນ້ຳ'] },
        { type: 'block', textAlign: 'start', fontFamily: 'Tibetan', children: ['སྒྲུ'] },
      ] as never),
    );
    const pdf = await PDFDocument.load(await renderPdf(tree, fonts, { subset: false }));
    const ref = pdf.getPages()[0].node.get(PDFName.of('Contents'));
    const st = ([pdf.context.lookup(ref)] as unknown[]).flatMap((o) => ((o as { asArray?: () => unknown[] }).asArray ? (o as { asArray: () => unknown[] }).asArray().map((r) => pdf.context.lookup(r as never)) : [o]));
    const c = st.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as never).decode())).join('\n');
    const utf16 = (s: string) => 'FEFF' + [...s].map((ch) => ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
    for (const unit of ['မြေ', 'កៅ', 'ນ້ຳ']) expect(c).toContain(`/Span <</ActualText <${utf16(unit)}>>> BDC`);
    expect(c.match(/ BDC/g)?.length ?? 0).toBe(c.match(/EMC/g)?.length ?? 0);
  });
});

describe('HTML・XSL-FO の入力でも同じに組める (同じ組版の道を通る)', () => {
  const KHMER = 'សិស្សទៅសាលារៀនរាល់ថ្ងៃដើម្បីរៀនភាសាខ្មែរនិងគណិតវិទ្យាយ៉ាងយកចិត្តទុកដាក់';
  const MYANMAR = 'ကျောင်းသားများသည်မြန်မာစာနှင့်သင်္ချာကိုသင်ယူရန်နေ့စဉ်ကျောင်းသို့သွားကြသည်';
  /** 行 (同じ y の字) ごとの字の単位の並び */
  const rowsOf = (tree: { sheets: Array<{ page: { regionBody: { children: Area[] } } }> }) => {
    const rows = new Map<number, GlyphArea[]>();
    const visit = (a: Area, oy: number) => {
      const y = oy + a.y;
      if (a.type === 'glyph') rows.set(Math.round(y * 100), [...(rows.get(Math.round(y * 100)) ?? []), a]);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, y);
    };
    for (const c of tree.sheets[0].page.regionBody.children) visit(c, 0);
    return [...rows.entries()].sort((p, q) => p[0] - q[0]).map((e) => e[1]);
  };
  it('クメール語・ミャンマー語の文が、HTML と XSL-FO で同じ字形・同じ所の折り返しになる', async () => {
    const { typeset, DEFAULT_FONTS } = await import('../src/index');
    const { ensureFonts, loadCachedFont } = await import('./helpers');
    await ensureFonts(DEFAULT_FONTS.base);
    const fontFiles = [
      { name: 'NotoSansKhmer-Regular.ttf', data: await buf('NotoSansKhmer-Regular-v29.ttf') },
      { name: 'NotoSansMyanmar-Regular.ttf', data: await buf('NotoSansMyanmar-Regular-v27.ttf') },
    ];
    const run = (text: string, kind: 'html' | 'fo') => typeset(text, { kind, fonts: fontFiles, loadFont: loadCachedFont, style: 'browser' });
    const html = await run(
      `<!doctype html><html><body style="font-size:10pt"><div lang="km" style="width:90pt;font-family:'Noto Sans Khmer'">${KHMER}</div><div lang="my" style="width:90pt;font-family:'Noto Sans Myanmar'">${MYANMAR}</div></body></html>`,
      'html',
    );
    const fo = await run(
      `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-size="10pt">` +
        `<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="150mm" page-height="200mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
        `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">` +
        `<fo:block-container width="90pt"><fo:block xml:lang="km" font-family="'Noto Sans Khmer'">${KHMER}</fo:block></fo:block-container>` +
        `<fo:block-container width="90pt"><fo:block xml:lang="my" font-family="'Noto Sans Myanmar'">${MYANMAR}</fo:block></fo:block-container>` +
        `</fo:flow></fo:page-sequence></fo:root>`,
      'fo',
    );
    const h = rowsOf(html.areaTree as never);
    const f = rowsOf(fo.areaTree as never);
    expect(h.length).toBeGreaterThan(6);
    expect(f.map((r) => r.map((g) => g.text))).toEqual(h.map((r) => r.map((g) => g.text)));
    expect(f.map((r) => r.map((g) => g.glyphIds))).toEqual(h.map((r) => r.map((g) => g.glyphIds)));
    expect(h.map((r) => r.map((g) => g.text).join('')).join('')).toBe(KHMER + MYANMAR);
    // XSL-FO (合字の指定が無い) でも、クメール文字の必須の合字 (子音 + AA) は 1 つの字形
    const aa = f.flat().find((g) => g.text === 'សា');
    expect(aa?.glyphIds).toHaveLength(1);
    expect(html.warnings.concat(fo.warnings).filter((w) => /描けません|字形/.test(w))).toEqual([]);
  }, 300_000);
});
