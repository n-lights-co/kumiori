/**
 * 書体の検査と、書体の表の読みの手間の上限 (src/fontSanity.ts と、書体の担当のファイルの上限)。
 * 壊れた・細工した書体で、時間とメモリを使い切らないこと、文書の全体を失敗にしないこと、正当な書体の結果を変えないことを確かめる。
 * 細工した書体は、手元の欧文の書体 (Tinos) の表を差し替えて、テストの中で組み立てる (test/colorFontBuilder.ts。書体のファイルはリポジトリに入れない)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { defaultFontBuffer, ensureFonts, extraTestFont } from './helpers';
import { Bytes, colr0, cpal, withTables } from './colorFontBuilder';
import { DEFAULT_FONTS } from '../src/index';
import { FontManager } from '../src/fontManager';
import { checkFontFile } from '../src/fontSanity';
import { colorFontOf } from '../src/colorGlyph';
import { FontFileError } from '../src/fontLoader';
import { instantiateFont, readVariationInfo } from '../src/fontInstancer';

let tinos: ArrayBuffer;
let gid: (ch: string) => number;
let numGlyphs: number;

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
  tinos = await defaultFontBuffer('Tinos-Regular.ttf');
  const fk = fontkit.create(new Uint8Array(tinos)) as unknown as { numGlyphs: number; glyphForCodePoint(cp: number): { id: number } };
  numGlyphs = fk.numGlyphs;
  gid = (ch: string) => fk.glyphForCodePoint(ch.codePointAt(0)!).id;
}, 300_000);

/** 表 tag の中身 */
function table(font: ArrayBuffer, tag: string): Uint8Array {
  const dv = new DataView(font);
  for (let k = 0; k < dv.getUint16(4); k++) {
    const at = 12 + 16 * k;
    if (String.fromCharCode(...new Uint8Array(font, at, 4)) === tag) return new Uint8Array(font, dv.getUint32(at + 8), dv.getUint32(at + 12)).slice();
  }
  throw new Error(`no ${tag}`);
}

/** 登録して、知らせた文を返す */
async function register(buffer: ArrayBuffer) {
  const fm = new FontManager();
  const notes: string[] = [];
  fm.onNotice = (m) => notes.push(m);
  const lf = await fm.registerBuffer('T', 400, buffer, false);
  return { fm, lf, notes };
}

/**
 * glyf・loca (長い形式) を作り直す: 字形 0 は 4 点の四角、字形 1〜depth は「1 つ前の字形を 2 つ持つ」複合の字形、ほかは空。
 * 字形 depth の点の数は 4 × 2 の depth 乗になる
 */
function chainGlyphs(depth: number): { glyf: Uint8Array; loca: Uint8Array; head: Uint8Array } {
  const glyphs: Uint8Array[] = [];
  glyphs.push(new Bytes().i16(1, 0, 0, 100, 100).u16(3, 0).u8(1, 1, 1, 1).i16(0, 100, 0, -100).i16(0, 0, 100, 0).done());
  for (let g = 1; g <= depth; g++) {
    // ARG_1_AND_2_ARE_WORDS | ARGS_ARE_XY_VALUES (| MORE_COMPONENTS)
    glyphs.push(new Bytes().i16(-1, 0, 0, 100, 100).u16(0x0023, g - 1).i16(0, 0).u16(0x0003, g - 1).i16(10, 0).done());
  }
  const b = new Bytes();
  const loca = new Bytes();
  for (let g = 0; g < numGlyphs; g++) {
    loca.u32(b.length);
    const data = glyphs[g];
    if (data) {
      b.raw(data);
      while (b.length % 4) b.u8(0);
    }
  }
  loca.u32(b.length);
  const head = table(tinos, 'head');
  new DataView(head.buffer).setInt16(50, 1);
  return { glyf: b.done(), loca: loca.done(), head };
}

describe('書体の登録のときの検査 (fontSanity.ts の checkFontFile・probeFont)', () => {
  it('正当な書体は、そのまま登録する (知らせ無し)', async () => {
    const { notes, lf } = await register(tinos);
    expect(notes).toEqual([]);
    expect(lf.buffer.byteLength).toBe(tinos.byteLength);
    expect(checkFontFile(tinos).buffer).toBe(tinos);
  });

  it('必ず使う表がファイルの外を指す書体は、読めない書体として登録しない', async () => {
    const bad = tinos.slice(0);
    const dv = new DataView(bad);
    for (let k = 0; k < dv.getUint16(4); k++) {
      const at = 12 + 16 * k;
      if (String.fromCharCode(...new Uint8Array(bad, at, 4)) === 'hmtx') dv.setUint32(at + 8, bad.byteLength - 4);
    }
    await expect(register(bad)).rejects.toBeInstanceOf(FontFileError);
  });

  it('loca が昇順でない書体は、読めない書体として登録しない', async () => {
    const loca = table(tinos, 'loca');
    const long = new DataView(table(tinos, 'head').buffer).getInt16(50) !== 0;
    const ld = new DataView(loca.buffer);
    // 字形 2 の位置を 0 にする (字形 1 より前)
    if (long) ld.setUint32(8, 0);
    else ld.setUint16(4, 0);
    await expect(register(withTables(tinos, { loca }))).rejects.toBeInstanceOf(FontFileError);
  });

  it('部品の展開が倍々になる複合の字形の鎖は、空の字形にして、すぐに登録する', async () => {
    const font = withTables(tinos, chainGlyphs(30));
    const t0 = performance.now();
    const { notes, lf } = await register(font);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(notes.join('\n')).toMatch(/複合の字形 \d+ 個を、空の字形/);
    // 鎖の初めの方 (点の数が上限に収まる字形) は、そのまま
    const fk = lf.fk as unknown as { getGlyph(id: number): { path: { commands: unknown[] } } };
    expect(fk.getGlyph(3).path.commands.length).toBeGreaterThan(0);
    expect(fk.getGlyph(30).path.commands.length).toBe(0);
  });
});

/** GSUB: 機能 liga が Lookup 0 を指す。Lookup i (i < depth) は文脈の置き換え (LookupType 5 の format 3) で、1 字に Lookup i+1 を fanout 回呼ぶ */
function gsubChain(depth: number, fanout: number, glyph: number): Uint8Array {
  const coverage = new Bytes().u16(1, 1, glyph).done();
  const lookups: Uint8Array[] = [];
  for (let i = 0; i <= depth; i++) {
    const st = new Bytes();
    if (i < depth) {
      // format 3: glyphCount 1, substCount fanout, coverage の位置, 記録 (sequenceIndex 0, lookupIndex i+1)
      const head = 6 + 2 + fanout * 4;
      st.u16(3, 1, fanout, head);
      for (let k = 0; k < fanout; k++) st.u16(0, i + 1);
      st.raw(coverage);
    } else {
      // LookupType 1 format 1: deltaGlyphID 0
      st.u16(1, 6, 0).raw(coverage);
    }
    lookups.push(new Bytes().u16(i < depth ? 5 : 1, 0, 1, 8).raw(st.done()).done());
  }
  const list = new Bytes().u16(lookups.length);
  let at = 2 + lookups.length * 2;
  for (const l of lookups) {
    list.u16(at);
    at += l.length;
  }
  for (const l of lookups) list.raw(l);
  const lookupList = list.done();
  // ScriptList: DFLT と latn、既定の LangSys が機能 0 を持つ
  const langSys = new Bytes().u16(0, 0xffff, 1, 0).done();
  const script = new Bytes().u16(4, 0).raw(langSys).done();
  const scriptList = new Bytes().u16(2).tag('DFLT').u16(14).tag('latn').u16(14 + script.length).raw(script).raw(script).done();
  const featureList = new Bytes().u16(1).tag('liga').u16(8).u16(0, 1, 0).done();
  const at1 = 10;
  const at2 = at1 + scriptList.length;
  const at3 = at2 + featureList.length;
  return new Bytes().u16(1, 0, at1, at2, at3).raw(scriptList).raw(featureList).raw(lookupList).done();
}

describe('整形の表の手間の上限', () => {
  it('Lookup が次の Lookup を 3 回ずつ呼ぶ鎖は、呼び出しの上限で止め、整形の表を使わずに組む', async () => {
    const font = withTables(tinos, { GSUB: gsubChain(16, 3, gid('A')), GPOS: null, GDEF: null });
    const { lf, notes } = await register(font);
    const t0 = performance.now();
    const run = (lf.fk as unknown as { layout(s: string): { glyphs: Array<{ id: number }> } }).layout('AAAA AAAA');
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(run.glyphs.map((g) => g.id)[0]).toBe(gid('A'));
    expect(notes.join('\n')).toMatch(/Lookup の呼び出しが多すぎる/);
  });

  it('呼び出しの少ない文脈の Lookup は、これまでどおり当たる (知らせ無し)', async () => {
    const { lf, notes } = await register(withTables(tinos, { GSUB: gsubChain(3, 2, gid('A')), GPOS: null, GDEF: null }));
    (lf.fk as unknown as { layout(s: string): unknown }).layout('AAAA');
    expect(notes).toEqual([]);
  });
});

describe('色つきの字形の層の上限 (colorGlyph.ts)', () => {
  it('65535 層の COLR version 0 の字形は、色つきにせず、すぐに返す', async () => {
    const layers: Array<[number, number]> = Array.from({ length: 65535 }, () => [gid('B'), 0]);
    const font = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers }]), CPAL: cpal([[[255, 0, 0, 255]]]) });
    const { lf, notes } = await register(font);
    const cf = colorFontOf(lf)!;
    const t0 = performance.now();
    expect(cf.glyph(gid('A'))).toBeUndefined();
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(notes.join('\n')).toMatch(/層・輪郭が多すぎる/);
  });

  it('層の少ない字形は、これまでどおり色つき', async () => {
    const font = withTables(tinos, { COLR: colr0([{ gid: gid('A'), layers: [[gid('B'), 0], [gid('C'), 0]] }]), CPAL: cpal([[[255, 0, 0, 255]]]) });
    const { lf } = await register(font);
    expect(colorFontOf(lf)!.glyph(gid('A'))?.ops.length).toBe(2);
  });
});

describe('可変フォント', () => {
  let varBuf: ArrayBuffer;
  beforeAll(async () => {
    const b = fs.readFileSync(await extraTestFont('Anybody-wdth-wght-5bb2873.ttf'));
    varBuf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }, 300_000);

  it('1 つの組で作る実体の数に上限を置き、超えたら近い実体で組む', async () => {
    const { fm, notes } = await register(varBuf);
    const made = new Set<unknown>();
    for (let w = 100; w <= 900; w += 5) made.add(fm.get('T', w));
    expect(made.size).toBeLessThanOrEqual(64);
    expect(made.size).toBeGreaterThan(16);
    expect(notes.join('\n')).toMatch(/実体 \(軸の値の組\) が多すぎます/);
  });

  it('正当な可変フォントの実体は、差分の手間の上限 (fontInstancer.ts) の中で作れる', () => {
    const info = readVariationInfo(varBuf)!;
    const t0 = performance.now();
    const r = instantiateFont(varBuf, info, info.axes.map((a) => a.max));
    expect(r.buffer.byteLength).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});
