/**
 * 組版の systemFonts (OS の書体を後備に使う選択肢): 読み込んだどの書体にも字形の無い字だけを、その字に限って OS の書体で組むこと。
 * 手元の OS の書体に頼らないよう、試験の中で小さな書体を組み立て (test/sfntTestFont.ts)、一時のディレクトリを探す場所に渡す
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { DEFAULT_FONTS, KumioriOptionError, createTypesetter, typeset, typesetToPdf, walkAreaTree, type GlyphArea, type SystemFontMatch, type SystemFontSource } from '../src/index';
import { createSystemFonts } from '../src/node';
import { ensureFonts, loadCachedFont } from './helpers';
import { buildTestFont } from './sfntTestFont';

let tmp: string;
const dirOf = (name: string, fonts: Array<[string, Uint8Array]>) => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  for (const [f, data] of fonts) fs.writeFileSync(path.join(d, f), data);
  return d;
};
/** 私用の領域の字 (既定の書体・記号・絵文字の書体のどれも持たない) */
const PUA1 = String.fromCodePoint(0xf0101);
const PUA2 = String.fromCodePoint(0xf0102);
const PUA3 = String.fromCodePoint(0xf0103);

const glyphs = (r: Awaited<ReturnType<typeof typeset>>) => {
  const out: Array<{ text: string; family: string; x: number; y: number }> = [];
  walkAreaTree(r.areaTree, (a) => {
    if (a.type === 'glyph') out.push({ text: (a as GlyphArea).text, family: (a as GlyphArea).fontFamily, x: (a as GlyphArea).baselineX, y: (a as GlyphArea).baselineY });
  });
  return out;
};
const codes = (r: { diagnostics: Array<{ code: string }> }) => r.diagnostics.map((d) => d.code);

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-sysfonts-typeset-'));
  await ensureFonts([...DEFAULT_FONTS.base, DEFAULT_FONTS.symbol, DEFAULT_FONTS.emoji]);
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('systemFonts (OS の書体を後備に使う)', () => {
  it('どの書体にも無い字だけを OS の書体で組み、font/missing-glyph の代わりに font/system-fallback を出す。ほかの字は変わらない', async () => {
    // OS の書体は、私用の字のほかに「あ」と「A」も持つが、それらは既定の書体のまま
    const dir = dirOf('basic', [['sys.ttf', buildTestFont({ family: 'Test System', chars: [0x41, 0x3042, 0xf0101] })]]);
    const html = `<p>Aあ${PUA1}いA</p>`;
    const before = await typeset(html, { loadFont: loadCachedFont });
    expect(codes(before)).toContain('font/missing-glyph');
    const after = await typeset(html, { loadFont: loadCachedFont, systemFonts: createSystemFonts({ dirs: [dir] }) });
    expect(codes(after)).not.toContain('font/missing-glyph');
    const fb = after.diagnostics.filter((d) => d.code === 'font/system-fallback');
    expect(fb).toHaveLength(1);
    expect(fb[0].severity).toBe('info');
    expect(fb[0].args).toEqual({ font: 'Test System (sys.ttf)', chars: PUA1 });
    const g0 = glyphs(before);
    const g1 = glyphs(after);
    const sys = g1.filter((g) => g.text.includes(PUA1));
    expect(sys.length).toBe(1);
    expect(sys[0].family).toMatch(/^Kumiori System /);
    // 私用の字の前の字は、書体も位置も同じ。ほかの字は、OS の書体で組まない
    const at = g1.findIndex((g) => g.text.includes(PUA1));
    expect(g1.slice(0, at)).toEqual(g0.slice(0, at));
    expect(g1.filter((g) => !g.text.includes(PUA1)).every((g) => !g.family.startsWith('Kumiori System'))).toBe(true);
    // PDF に、OS の書体を埋め込む
    const doc = await PDFDocument.load(await after.toPdf());
    const names = doc.context
      .enumerateIndirectObjects()
      .map(([, o]) => (o instanceof PDFDict ? o.get(PDFName.of('FontName')) : undefined))
      .filter((n): n is PDFName => n instanceof PDFName)
      .map((n) => n.decodeText());
    expect(names.some((n) => n.endsWith('+TestSystem-Regular'))).toBe(true);
  });

  it('欠けた字の無い文書では、探さない', async () => {
    let calls = 0;
    const spy: SystemFontSource = {
      find: () => {
        calls++;
        return Promise.resolve([]);
      },
    };
    const r = await typeset('<p>あいう ABC</p>', { loadFont: loadCachedFont, systemFonts: spy });
    expect(calls).toBe(0);
    expect(codes(r)).not.toContain('font/system-fallback');
  });

  it('器では、OS の書体を 1 度だけ読み、字の限りは文書ごと。font-family からは OS の書体を名指しできない', async () => {
    const dir = dirOf('typesetter', [['sys.ttf', buildTestFont({ family: 'Test Reuse', chars: [0x42, 0xf0101, 0xf0102] })]]);
    const inner = createSystemFonts({ dirs: [dir] });
    let reads = 0;
    const counting: SystemFontSource = {
      find: async (req) =>
        (await inner.find(req)).map(
          (m): SystemFontMatch => ({
            ...m,
            data: () => {
              reads++;
              return m.data();
            },
          }),
        ),
    };
    const t = await createTypesetter({ loadFont: loadCachedFont, systemFonts: counting });
    const r1 = await t.typeset(`<p>${PUA1}</p>`);
    const r2 = await t.typeset(`<p>${PUA2}B</p>`);
    expect(reads).toBe(1);
    expect(r1.diagnostics.find((d) => d.code === 'font/system-fallback')?.args).toEqual({ font: 'Test Reuse (sys.ttf)', chars: PUA1 });
    expect(r2.diagnostics.find((d) => d.code === 'font/system-fallback')?.args).toEqual({ font: 'Test Reuse (sys.ttf)', chars: PUA2 });
    const family = glyphs(r1).find((g) => g.text.includes(PUA1))!.family;
    // B は既定の書体にあるので、OS の書体の限りに入らない (前の文書で入れた書体も、この文書の字の限りで使う)
    expect(glyphs(r2).find((g) => g.text.includes('B'))!.family).not.toBe(family);
    // 内部の名前を font-family に書いても、OS の書体は選ばれない
    const r3 = await t.typeset(`<p style="font-family: '${family}'">B${PUA2}</p>`);
    expect(glyphs(r3).find((g) => g.text.includes('B'))!.family).not.toBe(family);
    // 文書ごとの設定に渡しても使われない (器の設定)
    const r4 = await t.typeset(`<p>${PUA3}</p>`, { systemFonts: counting } as never);
    expect(codes(r4)).toContain('api/setup-option-ignored');
  });

  it('器の文書ごとの設定に渡した systemFonts は、警告のとおり使わない (器の systemFonts を上書きもしない)', async () => {
    const dir = dirOf('per-document', [['sys.ttf', buildTestFont({ family: 'Test Per Document', chars: [0xf0101] })]]);
    let calls = 0;
    const spy: SystemFontSource = {
      find: (req) => {
        calls++;
        return createSystemFonts({ dirs: [dir] }).find(req);
      },
    };
    // 器に systemFonts が無ければ、文書ごとに渡しても OS の書体を探さない
    const plain = await createTypesetter({ loadFont: loadCachedFont });
    const r1 = await plain.typeset(`<p>${PUA1}</p>`, { systemFonts: spy } as never);
    const r1p = await plain.typesetToPdf(`<p>${PUA1}</p>`, { systemFonts: spy } as never);
    expect(calls).toBe(0);
    for (const r of [r1, r1p]) {
      expect(codes(r)).toEqual(expect.arrayContaining(['api/setup-option-ignored', 'font/missing-glyph']));
      expect(codes(r)).not.toContain('font/system-fallback');
    }
    // 器の systemFonts があれば、文書ごとのものでなく、器のものを使う
    let setupCalls = 0;
    const setupSpy: SystemFontSource = {
      find: (req) => {
        setupCalls++;
        return createSystemFonts({ dirs: [dir] }).find(req);
      },
    };
    const withSetup = await createTypesetter({ loadFont: loadCachedFont, systemFonts: setupSpy });
    const r2 = await withSetup.typeset(`<p>${PUA1}</p>`, { systemFonts: spy } as never);
    expect(calls).toBe(0);
    expect(setupCalls).toBe(1);
    expect(codes(r2)).toEqual(expect.arrayContaining(['api/setup-option-ignored', 'font/system-fallback']));
  });

  it('埋め込めない書体は使わず font/system-font-not-embeddable を出す。字は font/missing-glyph にも出る', async () => {
    const dir = dirOf('restricted', [['r.ttf', buildTestFont({ family: 'Test Restricted', chars: [0xf0101], fsType: 0x0002 })]]);
    const r = await typeset(`<p>あ${PUA1}</p>`, { loadFont: loadCachedFont, systemFonts: createSystemFonts({ dirs: [dir] }) });
    expect(codes(r)).toEqual(expect.arrayContaining(['font/system-font-not-embeddable', 'font/missing-glyph']));
    expect(r.diagnostics.find((d) => d.code === 'font/system-font-not-embeddable')!.args).toEqual({ font: 'Test Restricted (r.ttf)', chars: PUA1 });
    expect(codes(r)).not.toContain('font/system-fallback');
  });

  it('1 つの文書で使う OS の書体の数は limits.systemFontFaces まで', async () => {
    const dir = dirOf('faces', [
      ['a.ttf', buildTestFont({ family: 'Test Face A', chars: [0xf0101] })],
      ['b.ttf', buildTestFont({ family: 'Test Face B', chars: [0xf0102] })],
    ]);
    const src = createSystemFonts({ dirs: [dir] });
    const all = await typeset(`<p>${PUA1}${PUA2}</p>`, { loadFont: loadCachedFont, systemFonts: src });
    expect(codes(all).filter((c) => c === 'font/system-fallback')).toHaveLength(2);
    const one = await typeset(`<p>${PUA1}${PUA2}</p>`, { loadFont: loadCachedFont, systemFonts: src, limits: { systemFontFaces: 1 } });
    expect(codes(one).filter((c) => c === 'font/system-fallback')).toHaveLength(1);
    expect(one.diagnostics.filter((d) => d.code === 'font/missing-glyph').map((d) => d.args?.char)).toEqual([PUA2]);
    // 上限に当たったことを知らせる (前は、字形の無い字になるだけだった)。上限に当たらなければ知らせない
    expect(one.diagnostics.find((d) => d.code === 'limit/reached')?.args?.limit).toBe('systemFontFaces');
    expect(codes(all)).not.toContain('limit/reached');
    // 上限を守らない部品でも、読むのは上限まで
    const loaded: string[] = [];
    const greedy: SystemFontSource = {
      find: async (req) => (await src.find({ ...req, maxFaces: Infinity })).map((m): SystemFontMatch => ({ ...m, data: () => (loaded.push(m.name), m.data()) })),
    };
    const g = await typeset(`<p>${PUA1}${PUA2}</p>`, { loadFont: loadCachedFont, systemFonts: greedy, limits: { systemFontFaces: 1 } });
    expect(loaded).toHaveLength(1);
    expect(codes(g)).toContain('limit/reached');
  });

  it('上限で選ばなかった書体の字は、埋め込めない書体が持っていても font/system-font-not-embeddable にしない', async () => {
    const dir = dirOf('faces-refused', [
      ['a.ttf', buildTestFont({ family: 'Test Cap A', chars: [0xf0101] })],
      ['b.ttf', buildTestFont({ family: 'Test Cap B', chars: [0xf0102] })],
      ['c.ttf', buildTestFont({ family: 'Test Cap Restricted', chars: [0xf0102], fsType: 0x0002 })],
    ]);
    const r = await typeset(`<p>${PUA1}${PUA2}</p>`, { loadFont: loadCachedFont, systemFonts: createSystemFonts({ dirs: [dir] }), limits: { systemFontFaces: 1 } });
    expect(codes(r)).toContain('limit/reached');
    expect(codes(r)).not.toContain('font/system-font-not-embeddable');
  });

  it('探すのに失敗したら font/load-failed にして組み続ける', async () => {
    const broken: SystemFontSource = { find: () => Promise.reject(new Error('boom')) };
    const r = await typeset(`<p>あ${PUA1}</p>`, { loadFont: loadCachedFont, systemFonts: broken });
    expect(codes(r)).toEqual(expect.arrayContaining(['font/load-failed', 'font/missing-glyph']));
    expect(r.pageCount).toBe(1);
  });

  it('明朝の文脈は明朝の OS の書体、ゴシックの文脈はゴシックの OS の書体で組む。合う書体が無ければほかの種類で補う', async () => {
    const dir = dirOf('kinds', [
      ['a-serif.ttf', buildTestFont({ family: 'Kind Serif', chars: [0xf0101], panose: [2, 2] })],
      ['b-sans.ttf', buildTestFont({ family: 'Kind Sans', chars: [0xf0101, 0xf0102], familyClass: 0x0800 })],
    ]);
    const html = `<p style="font-family: serif">あ${PUA1}${PUA2}</p><p style="font-family: sans-serif">あ${PUA1}${PUA2}</p>`;
    const r = await typeset(html, { loadFont: loadCachedFont, systemFonts: createSystemFonts({ dirs: [dir] }) });
    expect(codes(r)).not.toContain('font/missing-glyph');
    expect(r.diagnostics.filter((d) => d.code === 'font/system-fallback').map((d) => d.args)).toEqual([
      { font: 'Kind Serif (a-serif.ttf)', chars: PUA1 },
      { font: 'Kind Sans (b-sans.ttf)', chars: PUA1 + PUA2 },
    ]);
    const g = glyphs(r).filter((x) => x.text.includes(PUA1) || x.text.includes(PUA2));
    // 読み込んだ順 (serif の書体 → sans の書体) に、内部の名前の番号が付く
    const [serifFace, sansFace] = ['Kumiori System 1', 'Kumiori System 2'];
    const pua1 = g.filter((x) => x.text.includes(PUA1)).map((x) => x.family);
    const pua2 = g.filter((x) => x.text.includes(PUA2)).map((x) => x.family);
    expect(pua1).toEqual([serifFace, sansFace]);
    // PUA2 はゴシックの書体にしか無いので、明朝の文脈でもゴシックの書体で補う
    expect(pua2).toEqual([sansFace, sansFace]);
  });

  it('文書で要る種類の OS の書体だけを読み、組むのに使った書体だけを知らせる', async () => {
    const dir = dirOf('kinds-needed', [
      ['a-serif.ttf', buildTestFont({ family: 'Need Serif', chars: [0xf0101, 0xf0102], panose: [2, 2] })],
      ['b-sans.ttf', buildTestFont({ family: 'Need Sans', chars: [0xf0101, 0xf0102], familyClass: 0x0800 })],
    ]);
    const inner = createSystemFonts({ dirs: [dir] });
    const read: string[] = [];
    const counting: SystemFontSource = {
      find: async (req) => (await inner.find(req)).map((m): SystemFontMatch => ({ ...m, data: () => (read.push(m.name), m.data()) })),
    };
    // 明朝の文脈だけ: 明朝の書体だけを読み、知らせも 1 件
    const r1 = await typeset(`<p style="font-family: serif">あ${PUA1}</p>`, { loadFont: loadCachedFont, systemFonts: counting });
    expect(read).toEqual(['Need Serif (a-serif.ttf)']);
    expect(r1.diagnostics.filter((d) => d.code === 'font/system-fallback').map((d) => d.args)).toEqual([{ font: 'Need Serif (a-serif.ttf)', chars: PUA1 }]);
    // ゴシックの文脈だけ (太字の見出しも): ゴシックの書体だけ
    read.length = 0;
    const r2 = await typeset(`<p style="font-family: sans-serif">a<b>${PUA1}</b></p>`, { loadFont: loadCachedFont, systemFonts: counting });
    expect(read).toEqual(['Need Sans (b-sans.ttf)']);
    expect(r2.diagnostics.filter((d) => d.code === 'font/system-fallback').map((d) => d.args)).toEqual([{ font: 'Need Sans (b-sans.ttf)', chars: PUA1 }]);
    // 明朝の文脈の字と、ゴシックの文脈の字が違えば、それぞれの書体は、その文脈の字だけを受け持つ
    read.length = 0;
    const r3 = await typeset(`<p style="font-family: serif">${PUA1}</p><p style="font-family: sans-serif">${PUA2}</p>`, { loadFont: loadCachedFont, systemFonts: counting });
    expect(read).toEqual(['Need Serif (a-serif.ttf)', 'Need Sans (b-sans.ttf)']);
    expect(r3.diagnostics.filter((d) => d.code === 'font/system-fallback').map((d) => d.args)).toEqual([
      { font: 'Need Serif (a-serif.ttf)', chars: PUA1 },
      { font: 'Need Sans (b-sans.ttf)', chars: PUA2 },
    ]);
    // XSL-FO も同じ (PDF だけを作るときも)
    read.length = 0;
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="a"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="a"><fo:flow flow-name="xsl-region-body"><fo:block font-family="sans-serif">${PUA1}</fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r4 = await typesetToPdf(fo, { loadFont: loadCachedFont, systemFonts: counting });
    expect(read).toEqual(['Need Sans (b-sans.ttf)']);
    expect(r4.diagnostics.filter((d) => d.code === 'font/system-fallback').map((d) => d.args)).toEqual([{ font: 'Need Sans (b-sans.ttf)', chars: PUA1 }]);
  });

  it('部品が返しても、組むのに使わなかった書体は知らせない (PDF だけを作るときも)', async () => {
    const dir = dirOf('unused', [['sys.ttf', buildTestFont({ family: 'Test Unused', chars: [0xf0101] })]]);
    const inner = createSystemFonts({ dirs: [dir] });
    // 同じ字の書体を 2 つ返す部品 (2 つ目は、1 つ目が字を持つので組むのに使われない)
    const twice: SystemFontSource = {
      find: async (req) => {
        const ms = await inner.find(req);
        return [...ms, ...ms.map((m) => ({ ...m, key: `${m.key}|again`, name: `${m.name} again` }))];
      },
    };
    const html = `<p>${PUA1}</p>`;
    const r = await typeset(html, { loadFont: loadCachedFont, systemFonts: twice });
    expect(r.diagnostics.filter((d) => d.code === 'font/system-fallback').map((d) => d.args?.font)).toEqual(['Test Unused (sys.ttf)']);
    for (const lowMemory of [false, true]) {
      const p = await typesetToPdf(html, { loadFont: loadCachedFont, systemFonts: twice }, { lowMemory });
      expect(p.diagnostics.filter((d) => d.code === 'font/system-fallback').map((d) => d.args?.font)).toEqual(['Test Unused (sys.ttf)']);
    }
  });

  it('指定の書体の種類が分からなければ、明朝の側の OS の書体を先に使う', async () => {
    const dir = dirOf('kinds-unknown', [
      ['a-sans.ttf', buildTestFont({ family: 'Kind Sans', chars: [0xf0101], familyClass: 0x0800 })],
      ['b-serif.ttf', buildTestFont({ family: 'Kind Serif', chars: [0xf0101], panose: [2, 2] })],
    ]);
    const user = buildTestFont({ family: 'Plain User', chars: [0x41] });
    const r = await typeset(`<p style="font-family: 'Plain User'">A${PUA1}</p>`, { loadFont: loadCachedFont, fonts: [{ name: 'user.ttf', data: user }], systemFonts: createSystemFonts({ dirs: [dir] }) });
    const fb = r.diagnostics.filter((d) => d.code === 'font/system-fallback').map((d) => d.args?.font);
    const g = glyphs(r);
    expect(g.find((x) => x.text.includes('A'))!.family).toBe('Plain User');
    // serif の書体が先に読まれる (Kumiori System 1)
    expect(fb[0]).toBe('Kind Serif (b-serif.ttf)');
    expect(g.find((x) => x.text.includes(PUA1))!.family).toBe('Kumiori System 1');
  });

  it('systemFonts が部品の形でなければ KumioriOptionError', async () => {
    await expect(typeset('<p>a</p>', { systemFonts: true as never })).rejects.toThrow(KumioriOptionError);
    await expect(typeset('<p>a</p>', { systemFonts: {} as never })).rejects.toThrow(/createSystemFonts/);
  });
});
