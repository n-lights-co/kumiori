/**
 * CFF2 の可変フォント (輪郭が CFF2 の OpenType): 軸の値を決めた実体を、静的な CFF (版 1) の OpenType に作り直す。
 *
 * 入力の書体は、テストの中でバイト列を組み立てる (test/cff2TestFont.ts。書体のファイルはリポジトリに入れない)。
 * 期待値は OpenType の仕様から手で計算したもの: 'CFF2' の表 (CharString の演算子・blend・vsindex・VariationStore)、
 * Font Variations の概説 (領域の重み)、'HVAR'・'VVAR'・'VORG'。
 */
import { describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { cffCharStrings, cffGidToCid, cffTable, readDict, readIndex, subsetCff } from '../src/cff';
import { instantiateFont, readVariationInfo } from '../src/fontInstancer';
import { FontManager } from '../src/fontManager';
import { typeset, walkAreaTree, type GlyphArea, type TypesetResult } from '../src/index';
import { buildCff2Font, charString } from './cff2TestFont';
import { loadCachedFont } from './helpers';

type Cmd = { command: string; args: number[] };
type Fk = {
  numGlyphs: number;
  unitsPerEm: number;
  postscriptName: string;
  getGlyph(id: number): { id: number; advanceWidth: number; advanceHeight: number; bbox: { minX: number; minY: number; maxX: number; maxY: number }; path: { commands: Cmd[] } };
  glyphForCodePoint(cp: number): { id: number; advanceWidth: number };
  directory: { tables: Record<string, unknown> };
  'OS/2': { usWeightClass: number; usWidthClass: number };
};
const fk = (buf: ArrayBuffer) => fontkit.create(new Uint8Array(buf)) as unknown as Fk;
const font = buildCff2Font();
const info = readVariationInfo(font)!;
const instance = (coords: Record<string, number>, buf = font) => instantiateFont(buf, readVariationInfo(buf)!, readVariationInfo(buf)!.axes.map((a) => coords[a.tag] ?? a.default)).buffer;
/** 字形の点の並び (輪郭ごと。曲線は制御点も) */
const points = (f: Fk, gid: number) => f.getGlyph(gid).path.commands.filter((c) => c.command !== 'closePath').map((c) => `${c.command[0]}${c.args.join(',')}`);
const tableOf = (buf: ArrayBuffer, tag: string): DataView | undefined => {
  const dv = new DataView(buf);
  for (let i = 0; i < dv.getUint16(4); i++) {
    const r = 12 + i * 16;
    if (String.fromCharCode(dv.getUint8(r), dv.getUint8(r + 1), dv.getUint8(r + 2), dv.getUint8(r + 3)) === tag) return new DataView(buf, dv.getUint32(r + 8), dv.getUint32(r + 12));
  }
  return undefined;
};

describe('CFF2 の可変フォントを読む', () => {
  it('軸と名前つきの実体を読む。輪郭は CFF2', () => {
    expect(info.cff2).toBe(true);
    expect(info.axes).toEqual([
      { tag: 'wght', min: 100, default: 400, max: 900 },
      { tag: 'wdth', min: 50, default: 100, max: 200 },
    ]);
    expect(info.instances).toEqual([{ name: 'Bold', coords: [700, 100] }]);
  });
});

describe('実体化: 静的な CFF の OpenType にする', () => {
  it('実体は静的な書体: CFF の表を持ち、CFF2 と可変フォントの表 (fvar・HVAR・VVAR) を持たない', () => {
    const buf = instance({ wght: 700 });
    expect(new DataView(buf).getUint32(0)).toBe(0x4f54544f);
    const f = fk(buf);
    expect(Object.keys(f.directory.tables).sort()).toEqual(['CFF ', 'OS/2', 'VORG', 'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'post', 'vhea', 'vmtx']);
    expect(f.numGlyphs).toBe(6);
    expect(f['OS/2'].usWeightClass).toBe(700);
  });
  it('既定の値の実体は、既定の形と、字の輪郭・送りが同じ (経路の演算子・部品・ヒントの読み飛ばし)', () => {
    const a = fk(font);
    const b = fk(instance({}));
    // 元の書体を fontkit がそのまま読んだものと比べる (fontkit の blend の計算は、小数の誤差を持つので丸める)
    const rounded = (f: Fk, g: number) => f.getGlyph(g).path.commands.filter((c) => c.command !== 'closePath').map((c) => `${c.command[0]}${c.args.map(Math.round).join(',')}`);
    for (const g of [0, 1, 3, 4, 5]) expect(points(b, g), `GID ${g}`).toEqual(rounded(a, g));
    for (let g = 0; g < 6; g++) expect(b.getGlyph(g).advanceWidth).toBe(Math.round(a.getGlyph(g).advanceWidth));
    expect(points(b, 1)).toEqual(['m50,0', 'l450,0', 'l450,700', 'l50,700']);
    // ヒント (hstemhm・書かれていない vstemhm・cntrmask・hintmask と 2 バイトの旗) を読み飛ばす
    expect(points(b, 5)).toEqual(['m100,200', 'l400,200', 'l400,500', 'l100,500']);
    // B: 経路の演算子を 1 つずつ (CFF2 の表の「CharString path operators」・「Flex mechanism operators」から手で計算した点)。
    // (fontkit は hflex・hflex1 の終点の y を始点に戻さないので、この字形は fontkit の読みと比べない)
    expect(points(b, 2)).toEqual([
      'm100,100',
      'b130,100,180,150,180,180', // rrcurveto (最初の数は、全体の部品が積んだ 30)
      'l160,180', // 局所の部品の hlineto
      'b170,180,190,210,190,250', // hvcurveto
      'b200,250,210,255,220,255', // flex
      'b230,255,240,250,250,250',
      'l255,255', // rlinecurve
      'l245,275',
      'b246,277,249,281,254,287',
      'b264,294,284,324,289,324', // hhcurveto (数が 4 の倍数 + 1)
      'b289,334,309,364,349,361', // vhcurveto (数が 4 の倍数 + 1)
      'b359,361,369,366,379,366', // hflex (終点は始点と同じ y)
      'b389,366,399,361,409,361',
      'b410,363,413,367,418,373', // rcurveline
      'l425,381',
      'b428,391,448,421,448,461', // vvcurveto (数が 4 の倍数 + 1)
      'b458,466,468,471,478,471', // hflex1 (終点は始点と同じ y)
      'b488,471,498,468,508,461',
      'b513,462,518,463,523,464', // flex1 (横に長いので、最後の数は dx。y は始点に戻る)
      'b528,463,533,462,542,461',
      'b552,461,572,491,572,531', // hvcurveto (2 本。横で始まる曲線と縦で始まる曲線)
      'b572,581,632,651,712,651',
      'l712,621', // vlineto (縦・横・縦)
      'l732,621',
      'l732,581',
    ]);
    // 輪郭は 3 次のまま (2 次への変換をしない)
    expect(b.getGlyph(2).path.commands.some((c) => c.command === 'quadraticCurveTo')).toBe(false);
  });
  it('blend: 差分に領域の重みを掛けて足す (1 つの blend で複数の値・軸の両側・2 つの軸の積)', () => {
    const rect = (c: Record<string, number>) => points(fk(instance(c)), 1);
    expect(rect({ wght: 900 })).toEqual(['m40,0', 'l530,0', 'l530,700', 'l40,700']);
    expect(rect({ wght: 100 })).toEqual(['m60,0', 'l400,0', 'l400,700', 'l60,700']);
    expect(rect({ wght: 650 })).toEqual(['m45,0', 'l490,0', 'l490,700', 'l45,700']);
    expect(rect({ wdth: 200 })).toEqual(['m50,0', 'l650,0', 'l650,700', 'l50,700']);
    expect(rect({ wght: 900, wdth: 200 })).toEqual(['m40,0', 'l760,0', 'l760,700', 'l40,700']);
    // 重みは 太い 0.5・広い 0.5・太くて広い 0.25: 右の辺は 45 + 400 + 45 + 100 + 7.5 = 597.5 → 598 (座標は整数に丸める。0.5 は上へ)
    expect(rect({ wght: 650, wdth: 150 })).toEqual(['m45,0', 'l598,0', 'l598,700', 'l45,700']);
  });
  it('vsindex: Private の指定 (FD ごと) と、字形の中の指定。途中の領域 (start・peak・end)。部品の中の blend', () => {
    // B (FD 1。差分の組 1 = 太い・途中の太さ): 全体の部品が積む数は 30 + 10·太い + 6·途中
    const firstX = (c: Record<string, number>) => fk(instance(c)).getGlyph(2).path.commands[1].args[0];
    expect(firstX({})).toBe(130);
    expect(firstX({ wght: 650 })).toBe(100 + 30 + 5 + 6);
    expect(firstX({ wght: 900 })).toBe(100 + 30 + 10);
    // 重みは 太い 0.25・途中 0.5: 100 + 35.5 → 136
    expect(firstX({ wght: 525 })).toBe(136);
    // C (FD 1 だが、字形の vsindex で差分の組 0): 始点は 200 + 20·太い
    expect(points(fk(instance({ wght: 900 })), 3)).toEqual(['m220,0', 'l320,0', 'l320,100']);
    expect(points(fk(instance({ wght: 650 })), 3)).toEqual(['m210,0', 'l310,0', 'l310,100']);
  });
  it('送り: hmtx に HVAR の差分を当て、字形 (CharString) の幅にも同じ値を入れる', () => {
    const buf = instance({ wght: 650, wdth: 150 });
    const f = fk(buf);
    expect(f.getGlyph(1).advanceWidth).toBe(500 + 40 + 100);
    expect(f.getGlyph(4).advanceWidth).toBe(250 + 15 + 50);
    expect(fk(instance({ wght: 525 })).getGlyph(4).advanceWidth).toBe(258);
    // 左の空き (hmtx の lsb) は、輪郭の左の端
    const hmtx = tableOf(buf, 'hmtx')!;
    expect(hmtx.getInt16(1 * 4 + 2)).toBe(45);
    // CFF の字形の幅: 最初の数 + nominalWidthX (無ければ defaultWidthX)。Private は FD ごと
    const cff = cffTable(new Uint8Array(buf))!;
    const widths = cffWidths(cff);
    expect(widths).toEqual([0, 1, 2, 3, 4, 5].map((g) => f.getGlyph(g).advanceWidth));
  });
  it('縦書き: vmtx に VVAR の差分を当て、縦書きの原点 (VORG) にも差分を当てる。上の空きは、原点から字の上の端まで', () => {
    const buf = instance({ wght: 900 });
    const vmtx = tableOf(buf, 'vmtx')!;
    expect(vmtx.getUint16(1 * 4)).toBe(1050);
    expect(vmtx.getUint16(2 * 4)).toBe(1000);
    const vorg = tableOf(buf, 'VORG')!;
    const origin = (g: number) => {
      for (let i = 0; i < vorg.getUint16(6); i++) if (vorg.getUint16(8 + i * 4) === g) return vorg.getInt16(8 + i * 4 + 2);
      return vorg.getInt16(4);
    };
    expect([0, 1, 2, 3, 4, 5].map(origin)).toEqual([890, 870, 890, 890, 890, 890]);
    // A: 原点 870、字の上の端 700
    expect(vmtx.getInt16(1 * 4 + 2)).toBe(170);
    // 縦書きの表の無い書体でも作れる
    const h = fk(instance({ wght: 900 }, buildCff2Font({ noVertical: true })));
    expect(Object.keys(h.directory.tables)).not.toContain('vmtx');
    expect(points(h, 1)).toEqual(['m40,0', 'l530,0', 'l530,700', 'l40,700']);
  });
  it('CFF の表: CID 方式 (CID = 字の番号)、FD は元のまま、Private の値は blend を計算した値。部分書体にできる', () => {
    const buf = instance({ wght: 900 });
    const cff = cffTable(new Uint8Array(buf))!;
    expect([...cffGidToCid(cff)!]).toEqual([0, 1, 2, 3, 4, 5]);
    const privs = cffPrivates(cff);
    expect(privs).toHaveLength(2);
    // FD 0: BlueValues は -10 0 700+2 712+… (差の並び: -10 10 702 10)、StdHW は 60 + 30
    expect(privs[0].get(6)).toEqual([-10, 10, 702, 10]);
    expect(privs[0].get(10)).toEqual([90]);
    expect(privs[0].get(1209)![0]).toBeCloseTo(0.039625, 9);
    // FD 1 (差分の組 1): StdVW は 80 + 20·太い + 5·途中 (太さ 900 では途中は 0)
    expect(privs[1].get(11)).toEqual([100]);
    expect(cffPrivates(cffTable(new Uint8Array(instance({ wght: 650 })))!)[1].get(11)).toEqual([95]);
    // 使う字だけの部分書体 (PDF に埋める形) にしても、字の番号は変わらない
    const sub = subsetCff(cff, new Set([1]));
    const cs = cffCharStrings(sub);
    expect(cs).toHaveLength(6);
    expect(cs[1]).toEqual(cffCharStrings(cff)[1]);
    expect([...cs[2]]).toEqual([14]);
  });
  it('unitsPerEm が 1000 でない書体は、CFF に FontMatrix を書く', () => {
    const buf = instance({ wght: 900 }, buildCff2Font({ unitsPerEm: 2000 }));
    const cff = cffTable(new Uint8Array(buf))!;
    const top = readDict(cff, ...readIndex(cff, readIndex(cff, cff[2]).end).items[0]);
    expect(top.find((e) => e.op === 1207)!.nums).toEqual([0.0005, 0, 0, 0.0005, 0, 0]);
    expect(fk(buf).unitsPerEm).toBe(2000);
  });
  it('範囲の外の軸の値は、端の値と同じ実体になる', () => {
    expect(new Uint8Array(instance({ wght: 2000, wdth: 1 }))).toEqual(new Uint8Array(instance({ wght: 900, wdth: 50 })));
  });
  it('読めない字形 (blend の値が足りない・部品の呼び出しが深すぎる) の書体は、作らずに投げる', () => {
    const bad = buildCff2Font({ glyphs: { 1: charString(50, 1, 'blend', 'hmoveto') } });
    expect(() => instance({ wght: 700 }, bad)).toThrow();
  });
});

/** CFF (版 1) の Private DICT (FD ごと。演算子 → 数の並び) */
function cffPrivates(cff: Uint8Array): Array<Map<number, number[]>> {
  const top = readDict(cff, ...readIndex(cff, readIndex(cff, cff[2]).end).items[0]);
  const fdArray = readIndex(cff, top.find((e) => e.op === 1236)!.nums[0]);
  return fdArray.items.map(([a, z]) => {
    const [size, at] = readDict(cff, a, z).find((e) => e.op === 18)!.nums;
    return new Map(readDict(cff, at, at + size).map((e) => [e.op, e.nums]));
  });
}

/** CFF (版 1) の字形の幅 (GID 順): CharString の最初の数 + nominalWidthX。数が偶数なら (幅が無ければ) defaultWidthX */
function cffWidths(cff: Uint8Array): number[] {
  const top = readDict(cff, ...readIndex(cff, readIndex(cff, cff[2]).end).items[0]);
  const privs = cffPrivates(cff);
  const sel = top.find((e) => e.op === 1237)!.nums[0];
  const n = cffCharStrings(cff).length;
  const fdOf = (g: number): number => {
    if (cff[sel] === 0) return cff[sel + 1 + g];
    const ranges = (cff[sel + 1] << 8) | cff[sel + 2];
    let fd = 0;
    for (let i = 0; i < ranges; i++) {
      const o = sel + 3 + i * 3;
      if (((cff[o] << 8) | cff[o + 1]) <= g) fd = cff[o + 2];
    }
    return fd;
  };
  return cffCharStrings(cff).slice(0, n).map((cs, g) => {
    const p = privs[fdOf(g)];
    // 最初の演算子までの数を数える (試験の字形は、幅 + moveto か endchar)
    const nums: number[] = [];
    let i = 0;
    while (i < cs.length) {
      const b0 = cs[i];
      if (b0 === 28) {
        nums.push(((cs[i + 1] << 24) | (cs[i + 2] << 16)) >> 16);
        i += 3;
      } else if (b0 >= 32 && b0 <= 246) {
        nums.push(b0 - 139);
        i++;
      } else if (b0 >= 247 && b0 <= 250) {
        nums.push((b0 - 247) * 256 + cs[i + 1] + 108);
        i += 2;
      } else if (b0 >= 251 && b0 <= 254) {
        nums.push(-(b0 - 251) * 256 - cs[i + 1] - 108);
        i += 2;
      } else break;
    }
    const op = cs[i];
    const need = op === 21 ? 2 : op === 14 ? 0 : 1;
    return nums.length > need ? nums[0] + (p.get(21)?.[0] ?? 0) : (p.get(20)?.[0] ?? 0);
  });
}

describe('書体の選び方: CFF2 の可変フォントも、太さ・軸の値ごとの実体を返す', () => {
  const setup = async () => {
    const fonts = new FontManager();
    const notices: string[] = [];
    fonts.onNotice = (m) => notices.push(m);
    const f = await fonts.registerBuffer('K2', 400, font, false);
    return { fonts, f, notices };
  };
  const isStaticCff = (buf: ArrayBuffer) => !!cffTable(new Uint8Array(buf)) && !tableOf(buf, 'CFF2') && !tableOf(buf, 'fvar');
  it('知らせを出さずに、可変フォントとして登録する', async () => {
    const { fonts, f, notices } = await setup();
    expect(notices).toEqual([]);
    expect(f.variable?.info.axes.map((a) => a.tag)).toEqual(['wght', 'wdth']);
    expect([...fonts.variationAxes()!]).toEqual(['wght', 'wdth']);
  });
  it('既定の形も、静的な CFF にした実体を返す (CFF2 のままでは PDF に埋め込めない)', async () => {
    const { fonts, f } = await setup();
    const d = fonts.get('K2', 400);
    expect(d).not.toBe(f);
    expect(d.instanceOf?.master).toBe(f);
    expect(d.instanceOf?.coords).toEqual({ wght: 400, wdth: 100 });
    expect(isStaticCff(d.buffer)).toBe(true);
    expect(d.family).toBe('K2');
    expect(fonts.get(d.family, d.weight)).toBe(d);
    expect(fonts.all()).toContain(d);
  });
  it('太さ・幅・font-variation-settings ごとの実体。同じ指定は同じ実体', async () => {
    const { fonts, f } = await setup();
    const bold = fonts.get('K2', 700);
    expect(bold.instanceOf?.coords).toEqual({ wght: 700, wdth: 100 });
    expect(bold.weight).toBe(700);
    expect(isStaticCff(bold.buffer)).toBe(true);
    expect(fonts.get('K2', 700)).toBe(bold);
    expect((bold.fk as unknown as Fk).glyphForCodePoint(0x41).advanceWidth).toBe(500 + 0.6 * 80);
    const wide = fonts.get('K2{wdth=200}', 400);
    expect(wide.instanceOf?.coords).toEqual({ wght: 400, wdth: 200 });
    expect((wide.fk as unknown as Fk).glyphForCodePoint(0x41).advanceWidth).toBe(700);
    expect(fonts.get('K2{;wght=900}', 400).instanceOf?.coords.wght).toBe(900);
    expect(bold.postscriptName).toBe('K2Test_700wght');
    expect(bold.instanceOf?.master).toBe(f);
  });
  it('可変でない CFF2 の書体 (fvar が無い) は、登録のときに静的な CFF にする (blend は既定の値)', async () => {
    const fonts = new FontManager();
    const notices: string[] = [];
    fonts.onNotice = (m) => notices.push(m);
    const f = await fonts.registerBuffer('S', 400, buildCff2Font({ noVariations: true }), false);
    expect(notices).toEqual([]);
    expect(f.variable).toBeUndefined();
    expect(isStaticCff(f.buffer)).toBe(true);
    expect(fonts.get('S', 700)).toBe(f);
    expect(points(f.fk as unknown as Fk, 1)).toEqual(['m50,0', 'l450,0', 'l450,700', 'l50,700']);
    expect((f.fk as unknown as Fk).getGlyph(2).path.commands[1].args[0]).toBe(130);
    expect((f.fk as unknown as Fk).glyphForCodePoint(0x41).advanceWidth).toBe(500);
  });
  it('実体を作れない CFF2 の書体は、知らせを出して、既定の形のまま使う', async () => {
    const fonts = new FontManager();
    const notices: string[] = [];
    fonts.onNotice = (m) => notices.push(m);
    const f = await fonts.registerBuffer('Bad', 400, buildCff2Font({ glyphs: { 1: charString(50, 1, 'blend', 'hmoveto') } }), false);
    expect(fonts.get('Bad', 700)).toBe(f);
    expect(fonts.get('Bad', 400)).toBe(f);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('CFF2');
  });
});

describe('組版 (HTML + CSS・XSL-FO): CFF2 の可変フォントの軸', () => {
  const file = (name: string, data: ArrayBuffer) => ({ name, data: new Uint8Array(data) });
  const glyphs = (r: TypesetResult): GlyphArea[] => {
    const out: GlyphArea[] = [];
    walkAreaTree(r.areaTree, (a) => {
      if (a.type === 'glyph') out.push(a as GlyphArea);
    });
    return out;
  };
  const em = (g: GlyphArea) => g.advance / g.fontSize;
  const html = (css: string, body: string) =>
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>@page { size: 200mm 100mm; margin: 10mm } body { font-size: 20pt; margin: 0 } @font-face { font-family: K; src: url(k.otf); font-weight: 100 900; font-stretch: 50% 200% } p { font-family: K; margin: 0 } ${css}</style></head><body>${body}</body></html>`;
  const run = (css: string, body: string) => typeset(html(css, body), { files: [file('k.otf', font)], loadFont: loadCachedFont });

  it('font-weight・font-stretch・font-variation-settings が軸の値になる (擬似太字にしない・字形を拡縮しない)。警告は出ない', async () => {
    const r = await run('', '<p>A<b>A</b><span style="font-stretch: 200%">A</span><span style="font-variation-settings: \'wght\' 650, \'wdth\' 150">A</span></p>');
    const g = glyphs(r).filter((x) => x.text === 'A');
    expect(g.map((x) => +em(x).toFixed(4))).toEqual([0.5, 0.548, 0.7, 0.64]);
    expect(g[1].fakeBold).toBeUndefined();
    expect(g[2].scaleX ?? 1).toBe(1);
    expect(r.warnings).toEqual([]);
  });
  it('縦書き: 横倒しの欧文の送りは、実体の横の送り。正立の字の送りは、これまでどおり字の大きさ', async () => {
    const r = await run('body { writing-mode: vertical-rl } p { font-weight: 900 }', '<p>A<span style="text-orientation: upright">A</span></p>');
    const g = glyphs(r).filter((x) => x.text === 'A');
    expect(g.map((x) => +em(x).toFixed(4))).toEqual([0.58, 1]);
    expect(g[0].fontFamily).toBe(g[1].fontFamily);
    expect(r.warnings).toEqual([]);
  });
  it('fonts の選択肢で足した CFF2 の可変フォント', async () => {
    const r = await typeset('<!DOCTYPE html><html lang="en"><head><style>p { font-family: K2Test; font-size: 20pt }</style></head><body><p>A<b>A</b></p></body></html>', { fonts: [file('K2Test.otf', font)], loadFont: loadCachedFont });
    const g = glyphs(r).filter((x) => x.text === 'A');
    expect(g.map((x) => +em(x).toFixed(4))).toEqual([0.5, 0.548]);
    expect(r.warnings).toEqual([]);
  });
  it('XSL-FO: font-weight・font-stretch が軸の値になる', async () => {
    const fo = `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="200mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
<fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-family="K2Test" font-size="20pt">A<fo:inline font-weight="900">A</fo:inline><fo:inline font-stretch="ultra-expanded">A</fo:inline></fo:block></fo:flow></fo:page-sequence></fo:root>`;
    const r = await typeset(fo, { kind: 'fo', files: [file('K2Test.otf', font)], loadFont: loadCachedFont });
    const g = glyphs(r).filter((x) => x.text === 'A');
    expect(g.map((x) => +em(x).toFixed(4))).toEqual([0.5, 0.58, 0.7]);
  });
  it('PDF: 既定の形も、実体ごとの静的な CFF (部分書体) として埋める。字は取り出せる (ToUnicode)', async () => {
    const r = await run('', '<p>AB <b>AD</b></p>');
    const pdf = await PDFDocument.load(await r.toPdf());
    const names: string[] = [];
    let toUnicode = 0;
    const programs: Uint8Array[] = [];
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font') && obj.get(PDFName.of('Subtype')) === PDFName.of('Type0')) {
        names.push(String(obj.get(PDFName.of('BaseFont'))));
        if (obj.get(PDFName.of('ToUnicode'))) toUnicode++;
      }
      if (obj instanceof PDFDict && obj.get(PDFName.of('FontFile3'))) {
        const s = pdf.context.lookup(obj.get(PDFName.of('FontFile3')));
        if (s instanceof PDFRawStream) programs.push(decodePDFRawStream(s).decode());
      }
    }
    const mine = names.map((n) => n.replace(/^\/[A-Z]{6}\+/, '')).sort();
    expect(mine).toEqual(['K2Test-Regular', 'K2Test_700wght', 'Tinos-Regular']);
    expect(toUnicode).toBe(3);
    // 埋めた書体は CFF (版 1)。字形は、使った字だけ (ほかは空)
    expect(programs).toHaveLength(2);
    for (const p of programs) {
      expect(p[0]).toBe(1);
      const cs = cffCharStrings(p);
      expect(cs).toHaveLength(6);
      expect(cs[1].length).toBeGreaterThan(1);
      expect([...cs[3]]).toEqual([14]);
    }
    expect(r.warnings).toEqual([]);
  });
});
