/**
 * テスト用の、小さな TrueType の書体 (輪郭が glyf の OpenType) を、バイト列で組み立てる (OS の書体を探す部品の試験など)。
 * 書体のファイルはリポジトリに入れないので、表を 1 つずつ書く。形は OpenType の仕様の各表のとおり
 * (https://learn.microsoft.com/typography/opentype/spec/ の head・hhea・maxp・OS/2・name・cmap・glyf・loca・hmtx・post)。
 * どの字も同じ四角の字形 (幅 1000 の中の 500 × 700) を持つ
 */

const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const i16 = (v: number) => u16(v < 0 ? v + 0x10000 : v);
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
const utf16 = (s: string) => [...s].flatMap((c) => u16(c.charCodeAt(0)));

export interface TestFontOptions {
  /** ファミリー名 (nameID 1・16) */
  family: string;
  /** nameID 16 (タイポグラフィのファミリー名) を、この名前と言語 (Windows の言語の ID) にする。無ければ family の英語 (0x409) */
  typographicFamily?: { name: string; lang: number };
  /** 持たせる字 (符号位置) */
  chars: readonly number[];
  /** OS/2 の値 */
  weight?: number;
  width?: number;
  italic?: boolean;
  fsType?: number;
  familyClass?: number;
  panose?: readonly number[];
  codePages?: number;
  /** cmap の部分表の形 (既定 12。4 は BMP の字だけ) */
  cmapFormat?: 4 | 12;
}

function checksum(b: number[]): number {
  let s = 0;
  for (let i = 0; i < b.length; i += 4) s = (s + ((b[i] << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
  return s;
}

/** 表の組から sfnt を組み立てる (表は名前の順に並べる) */
function sfnt(tables: Record<string, number[]>): Uint8Array {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  const out: number[] = [...u32(0x00010000), ...u16(n), ...u16(searchRange), ...u16(entrySelector), ...u16(n * 16 - searchRange)];
  let offset = 12 + n * 16;
  const body: number[] = [];
  for (const t of tags) {
    const data = tables[t];
    out.push(...tag(t), ...u32(checksum(data)), ...u32(offset), ...u32(data.length));
    body.push(...data);
    while (body.length % 4) body.push(0);
    offset = 12 + n * 16 + body.length;
  }
  return Uint8Array.from([...out, ...body]);
}

function cmap12(chars: readonly number[]): number[] {
  const groups: Array<[number, number, number]> = [];
  chars.forEach((c, i) => {
    const g = groups[groups.length - 1];
    if (g && g[1] + 1 === c && g[2] + (c - g[0]) === i + 1) g[1] = c;
    else groups.push([c, c, i + 1]);
  });
  const sub = [...u16(12), ...u16(0), ...u32(16 + groups.length * 12), ...u32(0), ...u32(groups.length), ...groups.flatMap(([s, e, g]) => [...u32(s), ...u32(e), ...u32(g)])];
  return [...u16(0), ...u16(1), ...u16(3), ...u16(10), ...u32(12), ...sub];
}

function cmap4(chars: readonly number[]): number[] {
  // 字ごとに 1 つの区間 (idDelta で字形の番号に当てる)。終わりの 0xFFFF の区間を足す
  const segs = chars.map((c, i) => ({ start: c, end: c, delta: (i + 1 - c) & 0xffff }));
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const segX2 = segs.length * 2;
  const es = Math.floor(Math.log2(segs.length));
  const sr = 2 ** es * 2;
  const body = [
    ...u16(segX2),
    ...u16(sr),
    ...u16(es),
    ...u16(segX2 - sr),
    ...segs.flatMap((s) => u16(s.end)),
    ...u16(0),
    ...segs.flatMap((s) => u16(s.start)),
    ...segs.flatMap((s) => u16(s.delta)),
    ...segs.flatMap(() => u16(0)),
  ];
  // format・length・language の後に本体 (length は部分表の全体の長さ)
  const sub = [...u16(4), ...u16(6 + body.length), ...u16(0), ...body];
  return [...u16(0), ...u16(1), ...u16(3), ...u16(1), ...u32(12), ...sub];
}

function nameTable(family: string, typographic?: { name: string; lang: number }): number[] {
  const recs: Array<[number, string, number]> = [
    [1, family, 0x409],
    [2, 'Regular', 0x409],
    [4, `${family} Regular`, 0x409],
    [6, family.replace(/[^A-Za-z0-9]/g, '') + '-Regular', 0x409],
    [16, typographic?.name ?? family, typographic?.lang ?? 0x409],
  ];
  const strings: number[] = [];
  const records: number[] = [];
  for (const [id, s, lang] of recs) {
    const b = utf16(s);
    records.push(...u16(3), ...u16(1), ...u16(lang), ...u16(id), ...u16(b.length), ...u16(strings.length));
    strings.push(...b);
  }
  return [...u16(0), ...u16(recs.length), ...u16(6 + records.length), ...records, ...strings];
}

/** 小さな TrueType の書体 */
export function buildTestFont(o: TestFontOptions): Uint8Array {
  const chars = [...new Set(o.chars)].sort((a, b) => a - b);
  const numGlyphs = chars.length + 1;
  // 字形: 0 は空 (.notdef)、ほかは四角 (点 4 つ。旗は on-curve だけ、座標は 2 バイトの差分)
  const square = [...i16(1), ...i16(100), ...i16(0), ...i16(600), ...i16(700), ...u16(3), ...u16(0), 1, 1, 1, 1, ...i16(100), ...i16(500), ...i16(0), ...i16(-500), ...i16(0), ...i16(0), ...i16(700), ...i16(0)];
  while (square.length % 4) square.push(0);
  const glyf: number[] = [];
  const loca: number[] = [...u32(0), ...u32(0)];
  for (let i = 1; i < numGlyphs; i++) {
    glyf.push(...square);
    loca.push(...u32(glyf.length));
  }
  const head = [...u32(0x00010000), ...u32(0x00010000), ...u32(0), ...u32(0x5f0f3cf5), ...u16(3), ...u16(1000), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...i16(0), ...i16(0), ...i16(1000), ...i16(800), ...u16(o.italic ? 2 : 0), ...u16(8), ...i16(2), ...i16(1), ...i16(0)];
  const hhea = [...u32(0x00010000), ...i16(800), ...i16(-200), ...i16(0), ...u16(1000), ...i16(0), ...i16(0), ...i16(1000), ...i16(1), ...i16(0), ...i16(0), 0, 0, 0, 0, 0, 0, 0, 0, ...i16(0), ...u16(numGlyphs)];
  const maxp = [...u32(0x00010000), ...u16(numGlyphs), ...u16(4), ...u16(1), ...u16(0), ...u16(0), ...u16(2), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0)];
  const panose = [...(o.panose ?? [])].concat(Array(10).fill(0)).slice(0, 10);
  const first = chars[0] ?? 0x20;
  const last = chars[chars.length - 1] ?? 0x20;
  const os2 = [
    ...u16(4),
    ...i16(1000),
    ...u16(o.weight ?? 400),
    ...u16(o.width ?? 5),
    ...u16(o.fsType ?? 0),
    ...[650, 600, 0, 75, 650, 600, 0, 350, 50, 250].flatMap(i16),
    ...i16(o.familyClass ?? 0),
    ...panose,
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...tag('TEST'),
    ...u16(o.italic ? 1 : 0x40),
    ...u16(Math.min(first, 0xffff)),
    ...u16(Math.min(last, 0xffff)),
    ...i16(800),
    ...i16(-200),
    ...i16(0),
    ...u16(800),
    ...u16(200),
    ...u32(o.codePages ?? 0),
    ...u32(0),
    ...i16(500),
    ...i16(700),
    ...u16(0),
    ...u16(0x20),
    ...u16(1),
  ];
  const hmtx = [...u16(1000), ...i16(0), ...chars.flatMap(() => [...u16(1000), ...i16(100)])];
  const post = [...u32(0x00030000), ...u32(0), ...i16(-100), ...i16(50), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0)];
  return sfnt({
    'OS/2': os2,
    cmap: (o.cmapFormat ?? 12) === 4 ? cmap4(chars.filter((c) => c < 0xffff)) : cmap12(chars),
    glyf,
    head,
    hhea,
    hmtx,
    loca,
    maxp,
    name: nameTable(o.family, o.typographicFamily),
    post,
  });
}

/** 書体を束ねた TTC (OpenType 1.9 の Font Collections。版 1.0)。表は書体ごとに写す (共有しない) */
export function buildTestCollection(fonts: readonly Uint8Array[]): Uint8Array {
  const header = 12 + fonts.length * 4;
  const parts: number[][] = [];
  const offsets: number[] = [];
  let pos = header;
  for (const f of fonts) {
    const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
    const n = v.getUint16(4);
    const dirLen = 12 + n * 16;
    const dir = [...f.subarray(0, dirLen)];
    const data = [...f.subarray(dirLen)];
    const base = pos + dirLen;
    // 表の位置を、TTC の頭からの位置に直す
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16 + 8;
      const off = v.getUint32(r) - dirLen + base;
      dir.splice(r, 4, ...u32(off));
    }
    offsets.push(pos);
    parts.push([...dir, ...data]);
    pos += dirLen + data.length;
  }
  return Uint8Array.from([...tag('ttcf'), ...u32(0x00010000), ...u32(fonts.length), ...offsets.flatMap(u32), ...parts.flat()]);
}
