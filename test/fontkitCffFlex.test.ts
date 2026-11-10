/**
 * fontkit の CFF の字形の hflex・hflex1 の読みの直し (src/fontkitCffFlex.ts)。
 *
 * 期待値は、OpenType 仕様「CFF2 — Compact Font Format (CFF) Version 2」の「CharString operators」の
 * 「Flex mechanism operators」の hflex・hflex1 の定義から決めた (Type 2 の字形の命令でも、同じ番号・同じ引数の演算子):
 *  - hflex [dx1 dx2 dy2 dx3 dx4 dx5 dx6]: 始点・終点・最初と最後の制御点の y が同じ。つなぎ目とその両隣の制御点の y が同じ
 *  - hflex1 [dx1 dy1 dx2 dy2 dx3 dx4 dx5 dy5 dx6]: 始点と終点の y が同じ。つなぎ目とその両隣の制御点の y が同じ
 * 書体のファイルはリポジトリに入れないので、hflex を使う CFF の書体は、ここでバイト列から組む。
 */
import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { instantiateFont, readVariationInfo, staticCff2ToCff } from '../src/fontInstancer';
import { FontManager } from '../src/fontManager';
import { patchFontkitCffFlex } from '../src/fontkitCffFlex';
import { buildCff2Font } from './cff2TestFont';
import { extraTestFont, fontBuffer } from './helpers';

type Cmd = { command: string; args: number[] };
type FkGlyph = { path: { commands: Cmd[] }; bbox: { minX: number; minY: number; maxX: number; maxY: number }; cbox: { minY: number; maxY: number } };
type FkCff = { fdForGlyph(gid: number): number | null };
type Fk = { getGlyph(gid: number): FkGlyph; numGlyphs: number; 'CFF '?: FkCff; CFF2?: FkCff };

const PATCHED = Symbol.for('kumiori.fontkitCffFlexPatched');

// ───────── CFF の書体をバイト列で組む (CFF = Adobe Technical Note #5176 の INDEX・DICT の形) ─────────

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
/** DICT の 4 バイトの整数 (長さが決まるので、位置を後から埋められる) */
const dictInt = (n: number) => [29, ...u32(n)];
/** 字形の命令の数 (−107〜107 は 1 バイト、ほかは 28 + 2 バイト) */
const num = (n: number) => (n >= -107 && n <= 107 ? [n + 139] : [28, ...u16(n & 0xffff)]);
const nums = (...a: number[]) => a.flatMap(num);
const index = (items: number[][]) => {
  if (!items.length) return [0, 0];
  const offs = [1];
  for (const it of items) offs.push(offs[offs.length - 1] + it.length);
  return [...u16(items.length), 2, ...offs.flatMap(u16), ...items.flat()];
};

const RMOVETO = 21;
const RLINETO = 5;
const HLINETO = 6;
const RRCURVETO = 8;
const HSTEM = 1;
const HINTMASK = 19;
const CALLSUBR = 10;
const RETURN = 11;
const ENDCHAR = 14;
const HFLEX = [12, 34];
const FLEX = [12, 35];
const HFLEX1 = [12, 36];
const FLEX1 = [12, 37];

/** hflex の引数 (どの字でも同じもの) */
const HFLEX_ARGS = [10, 20, 5, 30, 40, -3, 50];

/** 字形の命令 (GID の順) */
const GLYPHS: number[][] = [
  /* 0 .notdef */ [ENDCHAR],
  /* 1 hflex */ [...nums(100, 200), RMOVETO, ...nums(...HFLEX_ARGS), ...HFLEX, ...nums(0, -100), RLINETO, ENDCHAR],
  /* 2 hflex1 */ [...nums(100, 200), RMOVETO, ...nums(1, 2, 3, 4, 5, 6, 7, 8, 9), ...HFLEX1, ...nums(0, -100), RLINETO, ENDCHAR],
  /* 3 flex */ [...nums(100, 200), RMOVETO, ...nums(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 50), ...FLEX, ...nums(0, -100), RLINETO, ENDCHAR],
  /* 4 flex1 (横) */ [...nums(100, 200), RMOVETO, ...nums(10, 2, 10, 4, 10, 6, 10, -8, 10, -10, 7), ...FLEX1, ...nums(0, -100), RLINETO, ENDCHAR],
  /* 5 flex1 (縦) */ [...nums(100, 200), RMOVETO, ...nums(2, 10, 4, 10, 6, 10, -8, 10, -10, 10, 7), ...FLEX1, ...nums(-100, 0), RLINETO, ENDCHAR],
  /* 6 部分の命令の中の hflex (局所の 0 番 = 偏り 107 を引いた −107) */ [...nums(100, 200), RMOVETO, ...nums(-107), CALLSUBR, ...nums(0, -100), RLINETO, ENDCHAR],
  /* 7 flex を使わない字 (幅・ヒント・直線・曲線・2 つの輪郭) */ [
    ...nums(33, 0, 50),
    HSTEM,
    HINTMASK,
    0x80,
    ...nums(10, 20),
    RMOVETO,
    ...nums(300, 400, -300),
    HLINETO,
    ...nums(50, 60),
    RMOVETO,
    ...nums(10, 20, 30, 40, 50, -60),
    RRCURVETO,
    ENDCHAR,
  ],
  /* 8 hflex が 2 つ続く字 (2 つ目は、1 つ目の終点から始まる) */ [...nums(100, 200), RMOVETO, ...nums(...HFLEX_ARGS), ...HFLEX, ...nums(...HFLEX_ARGS), ...HFLEX, ENDCHAR],
];
const SUBRS: number[][] = [[...nums(...HFLEX_ARGS), ...HFLEX, RETURN]];

function makeCff(): number[] {
  const header = [1, 0, 4, 1];
  const name = index([[...'Flex'].map((c) => c.charCodeAt(0))]);
  const strings = index([]);
  const gsubrs = index([]);
  const charStrings = index(GLYPHS);
  const subrs = index(SUBRS);
  // Private DICT: nominalWidthX 0、Subrs (Private DICT の先頭からの位置)
  const priv = (subrsOff: number) => [...dictInt(subrsOff), 19];
  const privLen = priv(0).length;
  // Top DICT: CharStrings (17)、Private (18: 長さと位置)
  const top = (cs: number, pv: number) => [...dictInt(cs), 17, ...dictInt(privLen), ...dictInt(pv), 18];
  const csAt = header.length + name.length + index([top(0, 0)]).length + strings.length + gsubrs.length;
  const pvAt = csAt + charStrings.length;
  return [...header, ...name, ...index([top(csAt, pvAt)]), ...strings, ...gsubrs, ...charStrings, ...priv(privLen), ...subrs];
}

/**
 * CID 方式の CFF: FD が 2 つで、局所の部分の命令の 0 番が FD ごとに違う (FD 0 は右へ 50、FD 1 は上へ 70 の線)。
 * どの字形も「(100, 200) へ動いて、局所の 0 番を呼ぶ」だけなので、線の向きで、どの FD の Private DICT で読まれたかが分かる。
 * FDSelect は形式 3: GID 0〜1 は FD 0、2〜3 は FD 1、4 は FD 0 (GID 2 と 4 が、範囲の最初の字)
 */
const CID_GLYPHS: number[][] = [[ENDCHAR], ...[1, 2, 3, 4].map(() => [...nums(100, 200), RMOVETO, ...nums(-107), CALLSUBR, ENDCHAR])];
const CID_FD = [0, 0, 1, 1, 0];

function makeCidCff(): number[] {
  const header = [1, 0, 4, 1];
  const name = index([[...'FlexCid'].map((c) => c.charCodeAt(0))]);
  const strings = index([[...'Adobe'].map((c) => c.charCodeAt(0)), [...'Identity'].map((c) => c.charCodeAt(0))]);
  const gsubrs = index([]);
  const charStrings = index(CID_GLYPHS);
  const fdSelect = [3, ...u16(3), ...u16(0), 0, ...u16(2), 1, ...u16(4), 0, ...u16(CID_GLYPHS.length)];
  const subrs = [index([[...nums(50), HLINETO, RETURN]]), index([[...nums(0, 70), RLINETO, RETURN]])];
  const priv = (subrsOff: number) => [...dictInt(subrsOff), 19];
  const privLen = priv(0).length;
  // Top DICT: ROS (SID 391 = Adobe、392 = Identity、0)、CharStrings (17)、FDArray (12 36)、FDSelect (12 37)
  const top = (o: { cs: number; fdArray: number; fdSelect: number }) => [...dictInt(391), ...dictInt(392), ...dictInt(0), 12, 30, ...dictInt(o.cs), 17, ...dictInt(o.fdArray), 12, 36, ...dictInt(o.fdSelect), 12, 37];
  const fd = (privAt: number) => [...dictInt(privLen), ...dictInt(privAt), 18];
  let at = header.length + name.length + index([top({ cs: 0, fdArray: 0, fdSelect: 0 })]).length + strings.length + gsubrs.length;
  const fdSelectAt = at;
  at += fdSelect.length;
  const csAt = at;
  at += charStrings.length;
  const fdArrayAt = at;
  at += index([fd(0), fd(0)]).length;
  // Private DICT と、そのすぐ後ろの局所の部分の命令 (FD ごと)
  const privAt = [at, at + privLen + subrs[0].length];
  return [...header, ...name, ...index([top({ cs: csAt, fdArray: fdArrayAt, fdSelect: fdSelectAt })]), ...strings, ...gsubrs, ...fdSelect, ...charStrings, ...index(privAt.map(fd)), ...priv(privLen), ...subrs[0], ...priv(privLen), ...subrs[1]];
}

/** CFF の表を持つ、最小の OpenType の書体 (fontkit が字形の輪郭を読むのに要る表だけ) */
function makeOtf(cff = makeCff(), n = GLYPHS.length): Uint8Array {
  const head = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0x5f0f3cf5), ...u16(0), ...u16(1000), ...new Array(16).fill(0), ...u16(0), ...u16(0), ...u16(1000), ...u16(1000), ...u16(0), ...u16(8), ...u16(2), ...u16(0), ...u16(0)];
  const hhea = [...u32(0x00010000), ...u16(800), ...u16(0x10000 - 200), ...u16(0), ...u16(1000), ...new Array(22).fill(0), ...u16(0), ...u16(n)];
  const maxp = [...u32(0x00005000), ...u16(n)];
  const hmtx = Array.from({ length: n }, () => [...u16(500), ...u16(0)]).flat();
  const tables: Array<[string, number[]]> = [
    ['CFF ', cff],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['maxp', maxp],
  ];
  let at = 12 + tables.length * 16;
  const dir: number[] = [];
  const body: number[] = [];
  for (const [tag, data] of tables) {
    dir.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(at), ...u32(data.length));
    const padded = [...data, ...new Array((4 - (data.length % 4)) % 4).fill(0)];
    body.push(...padded);
    at += padded.length;
  }
  return new Uint8Array([0x4f, 0x54, 0x54, 0x4f, ...u16(tables.length), ...u16(64), ...u16(2), ...u16(16), ...dir, ...body]);
}

const open = (b: Uint8Array) => fontkit.create(b) as unknown as Fk;
const commands = (fk: Fk, gid: number) => fk.getGlyph(gid).path.commands.map((c) => ({ command: c.command, args: [...c.args] }));
const allCommands = (fk: Fk, count: number) => Array.from({ length: count }, (_, gid) => JSON.stringify(commands(fk, gid)));
const M = (...args: number[]) => ({ command: 'moveTo', args });
const L = (...args: number[]) => ({ command: 'lineTo', args });
const C = (...args: number[]) => ({ command: 'bezierCurveTo', args });
const Z = { command: 'closePath', args: [] };
const cffProto = (fk: Fk) => Object.getPrototypeOf(fk.getGlyph(0)) as { _getPath: unknown; [PATCHED]?: boolean };

describe('fontkit の CFF の字形の hflex・hflex1 (fontkitCffFlex.ts)', () => {
  const otf = makeOtf();
  /** 差し替える前の fontkit の読み (字形の番号 → 輪郭の命令の JSON) */
  let before: string[];
  let sourceSans: Uint8Array;
  let sourceSansBefore: string[];
  let fk: Fk;
  const cidOtf = makeOtf(makeCidCff(), CID_GLYPHS.length);
  let cidBefore: string[];
  /** CFF2 の書体から作った静的な CFF (既定の形の実体・太さ 700 の実体・可変でない CFF2 を CFF にしたもの) */
  const cff2 = buildCff2Font();
  const cff2Info = readVariationInfo(cff2)!;
  const fromCff2 = [
    instantiateFont(cff2, cff2Info, cff2Info.axes.map((a) => a.default)).buffer,
    instantiateFont(cff2, cff2Info, cff2Info.axes.map((a) => (a.tag === 'wght' ? 700 : a.default))).buffer,
    staticCff2ToCff(buildCff2Font({ noVariations: true }))!,
  ].map((b) => new Uint8Array(b));
  let fromCff2Before: string[][];

  beforeAll(async () => {
    // 差し替えは原型 (prototype) に当たるので、当てる前の読みを先に取っておく (字形は読んだ輪郭を覚えるので、後で書体を作り直す)
    const raw = open(otf);
    expect(cffProto(raw)[PATCHED]).toBeUndefined();
    before = allCommands(raw, GLYPHS.length);
    sourceSans = new Uint8Array(fs.readFileSync(await extraTestFont('SourceSans3-Regular-3.052R.otf')));
    const ss = open(sourceSans);
    sourceSansBefore = allCommands(ss, ss.numGlyphs);
    cidBefore = allCommands(open(cidOtf), CID_GLYPHS.length);
    fromCff2Before = fromCff2.map((b) => allCommands(open(b), open(b).numGlyphs));
    fk = open(otf);
    patchFontkitCffFlex(fk);
  });

  it('組んだ書体を fontkit が読める (直す前は、hflex の終点の y が始点に戻らない)', () => {
    expect(JSON.parse(before[7])).toEqual([M(10, 20), L(310, 20), L(310, 420), L(10, 420), Z, M(60, 480), C(70, 500, 100, 540, 150, 480), Z]);
    // fontkit の元の読み: 終点が (247, 205) になり、続く線も 5 ずれる
    expect(JSON.parse(before[1]).slice(2)).toEqual([C(200, 205, 197, 205, 247, 205), L(247, 105), Z]);
  });

  it('hflex: 最後の制御点と終点の y は、始点の y に戻る', () => {
    expect(commands(fk, 1)).toEqual([M(100, 200), C(110, 200, 130, 205, 160, 205), C(200, 205, 197, 200, 247, 200), L(247, 100), Z]);
  });

  it('hflex1: 終点の y は、始点の y に戻る', () => {
    expect(commands(fk, 2)).toEqual([M(100, 200), C(101, 202, 104, 206, 109, 206), C(115, 206, 122, 214, 131, 200), L(131, 100), Z]);
  });

  it('部分の命令 (subr) の中の hflex も直る', () => {
    expect(commands(fk, 6)).toEqual(commands(fk, 1));
  });

  it('hflex が続くとき、2 つ目は 1 つ目の正しい終点から始まる', () => {
    expect(commands(fk, 8)).toEqual([M(100, 200), C(110, 200, 130, 205, 160, 205), C(200, 205, 197, 200, 247, 200), C(257, 200, 277, 205, 307, 205), C(347, 205, 344, 200, 394, 200), Z]);
  });

  it('字形の外接枠も、直した輪郭から決まる', () => {
    // 直す前は、続く線が 5 ずれて、下端が 105 になる
    expect(fk.getGlyph(1).bbox.minY).toBe(100);
    expect(fk.getGlyph(1).cbox.minY).toBe(100);
    expect(fk.getGlyph(1).cbox.maxY).toBe(205);
  });

  it('flex・flex1 と、flex を使わない字の輪郭は、差し替えの前と同じ', () => {
    for (const gid of [0, 3, 4, 5, 7]) expect(JSON.stringify(commands(fk, gid)), `GID ${gid}`).toBe(before[gid]);
    expect(commands(fk, 3)).toEqual([M(100, 200), C(101, 202, 104, 206, 109, 212), C(116, 220, 125, 230, 136, 242), L(136, 142), Z]);
  });

  it('差し替えは二重に当たらない', () => {
    const proto = cffProto(fk);
    const patched = proto._getPath;
    expect(proto[PATCHED]).toBe(true);
    patchFontkitCffFlex(fk);
    patchFontkitCffFlex(open(otf));
    expect(proto._getPath).toBe(patched);
    expect(commands(open(otf), 1)).toEqual(commands(fk, 1));
  });

  it('hflex・hflex1 を使わない実物の書体 (Source Sans 3) は、全字の輪郭が差し替えの前と同じ', () => {
    const ss = open(sourceSans);
    expect(cffProto(ss)[PATCHED]).toBe(true);
    expect(ss.numGlyphs).toBeGreaterThan(2000);
    const after = allCommands(ss, ss.numGlyphs);
    const differ = after.flatMap((s, gid) => (s === sourceSansBefore[gid] ? [] : [gid]));
    expect(differ).toEqual([]);
  });

  it('FDSelect (形式 3): 範囲の最初の字も、その範囲の FD の Private DICT (局所の部分の命令) で読む', () => {
    // OpenType 仕様「CFF2」の「Range3 record」: 範囲は、その first の字から、次の範囲の first の手前の字まで。
    // 直す前の fontkit は、範囲の最初の字を、前の範囲の FD で読むことがある (二分探索が前の範囲に当たったとき。ここでは GID 4)
    const right = [M(100, 200), L(150, 200), Z];
    const up = [M(100, 200), L(100, 270), Z];
    expect(cidBefore.map((s) => JSON.parse(s))).toEqual([[], right, up, up, up]);
    const cid = open(cidOtf);
    expect(CID_FD.map((_, gid) => cid['CFF ']!.fdForGlyph(gid))).toEqual(CID_FD);
    expect([1, 2, 3, 4].map((gid) => commands(cid, gid))).toEqual([right, up, up, right]);
  });

  it('FDSelect の無い書体・形式 3 でない引き方は、fontkit の元のまま', () => {
    expect(fk['CFF ']!.fdForGlyph(1)).toBeNull();
  });

  it('CFF2 の書体の FDSelect も、範囲の最初の字を正しく引く (CFF2 の字形の輪郭の読み方は変えない)', () => {
    // test/cff2TestFont.ts の FDSelect: GID 0〜1 は FD 0、2〜4 は FD 1、5 は FD 0
    const master = open(new Uint8Array(cff2));
    expect([0, 1, 2, 3, 4, 5].map((gid) => master.CFF2!.fdForGlyph(gid))).toEqual([0, 0, 1, 1, 1, 0]);
  });

  it('CFF2 から作った静的な CFF (実体・可変でない CFF2 を CFF にしたもの) は、全字の輪郭が差し替えの前と同じ', () => {
    fromCff2.forEach((b, k) => {
      const f = open(b);
      expect(f.numGlyphs).toBe(6);
      expect(cffProto(f)[PATCHED]).toBe(true);
      expect(allCommands(f, f.numGlyphs), `書体 ${k}`).toEqual(fromCff2Before[k]);
    });
  });

  it('TrueType の字形の読みは差し替えない。書体を登録すると、CFF の字形の読みが差し替わる', async () => {
    const fonts = new FontManager();
    const tt = await fonts.registerBuffer('TT', 400, await fontBuffer(), false);
    const ttProto = Object.getPrototypeOf((tt.fk as unknown as Fk).getGlyph(1)) as { [PATCHED]?: boolean };
    expect(ttProto[PATCHED]).toBeUndefined();
    patchFontkitCffFlex(tt.fk);
    expect(ttProto[PATCHED]).toBeUndefined();
    const cff = await fonts.registerBuffer('CFF', 400, sourceSans.buffer.slice(sourceSans.byteOffset, sourceSans.byteOffset + sourceSans.byteLength) as ArrayBuffer, false);
    expect(cffProto(cff.fk as unknown as Fk)[PATCHED]).toBe(true);
  });
});
