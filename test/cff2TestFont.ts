/**
 * テスト用の、小さな CFF2 の可変フォント (輪郭が CFF2 の OpenType) を、バイト列で組み立てる (test/cff2VariableFonts.test.ts)。
 * 書体のファイルはリポジトリに入れないので、表を 1 つずつ書く。形は OpenType の仕様の各表のとおり
 * (https://learn.microsoft.com/typography/opentype/spec/ の cff2・fvar・hvar・vvar・vorg・otvarcommonformats)。
 *
 * 軸: wght 100〜400〜900、wdth 50〜100〜200。領域 (VariationRegion。F2Dot14):
 *   R0 太い (wght 0→1)、R1 細い (wght -1←0)、R2 広い (wdth 0→1)、R3 太くて広い (wght 0→1 かつ wdth 0→1)、R4 途中の太さ (wght 0→0.5→1)
 * 字 (GID):
 *   0 .notdef (空)
 *   1 A: 長方形。左右の辺に差分 (1 つの blend で 3 つの値)。FD 0 (差分の組 0 = R0〜R3)
 *   2 B: 曲線・flex・全体の部品 (blend を含む)・局所の部品。FD 1 (Private の vsindex = 1 → R0・R4)
 *   3 C: 三角形。FD 1 だが、字形の中の vsindex で差分の組 0 を選ぶ
 *   4 空白 (空。送りだけ変わる)
 *   5 D: 長方形。ヒント (hstemhm・書かれていない vstemhm・cntrmask・hintmask。旗は 2 バイト)
 */

const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const fixed = (v: number) => u32(Math.round(v * 65536));
const f2dot14 = (v: number) => u16(Math.round(v * 16384));
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** CharString・DICT の数 (整数は短い形、小数は CharString の 16.16) */
function num(v: number): number[] {
  if (!Number.isInteger(v)) return [255, ...u32(Math.round(v * 65536))];
  if (v >= -107 && v <= 107) return [v + 139];
  if (v >= 108 && v <= 1131) return [247 + ((v - 108) >> 8), (v - 108) & 0xff];
  if (v >= -1131 && v <= -108) return [251 + ((-v - 108) >> 8), (-v - 108) & 0xff];
  return [28, ...u16(v)];
}

const CS_OPS: Record<string, number[]> = {
  hstem: [1],
  vstem: [3],
  vmoveto: [4],
  rlineto: [5],
  hlineto: [6],
  vlineto: [7],
  rrcurveto: [8],
  callsubr: [10],
  vsindex: [15],
  blend: [16],
  hstemhm: [18],
  hintmask: [19],
  cntrmask: [20],
  rmoveto: [21],
  hmoveto: [22],
  vstemhm: [23],
  rcurveline: [24],
  rlinecurve: [25],
  vvcurveto: [26],
  hhcurveto: [27],
  callgsubr: [29],
  vhcurveto: [30],
  hvcurveto: [31],
  hflex: [12, 34],
  flex: [12, 35],
  hflex1: [12, 36],
  flex1: [12, 37],
};

/** CharString を書く: 数、演算子の名前、そのままのバイト列 ({ raw }) の並び */
export function charString(...tokens: Array<number | string | { raw: number[] }>): Uint8Array {
  const out: number[] = [];
  for (const t of tokens) {
    if (typeof t === 'number') out.push(...num(t));
    else if (typeof t === 'string') {
      if (!CS_OPS[t]) throw new Error(`unknown operator ${t}`);
      out.push(...CS_OPS[t]);
    } else out.push(...t.raw);
  }
  return new Uint8Array(out);
}

/** CFF2 の INDEX (count は uint32) */
function index2(items: Uint8Array[]): number[] {
  if (!items.length) return u32(0);
  const total = items.reduce((a, x) => a + x.length, 0) + 1;
  const offSize = total < 0x100 ? 1 : total < 0x10000 ? 2 : 4;
  const out = [...u32(items.length), offSize];
  let off = 1;
  const put = (x: number) => out.push(...u32(x).slice(4 - offSize));
  put(off);
  for (const it of items) put((off += it.length));
  for (const it of items) out.push(...it);
  return out;
}

/** DICT の位置 (長さの決まる 4 バイトの整数) */
const int32 = (v: number) => [29, ...u32(v)];

/** 領域の並び (VariationRegionList): 軸ごとの [start, peak, end] */
const REGIONS: number[][][] = [
  [[0, 1, 1], [0, 0, 0]],
  [[-1, -1, 0], [0, 0, 0]],
  [[0, 0, 0], [0, 1, 1]],
  [[0, 1, 1], [0, 1, 1]],
  [[0, 0.5, 1], [0, 0, 0]],
];

/**
 * Item Variation Store。datas: 差分の組ごとの、使う領域の番号と、項目ごとの差分 (int16。CFF2 の中のものは項目を持たない)
 */
function itemVariationStore(datas: Array<{ regions: number[]; items: number[][] }>): number[] {
  const regionList = [...u16(2), ...u16(REGIONS.length), ...REGIONS.flatMap((r) => r.flatMap(([s, p, e]) => [...f2dot14(s), ...f2dot14(p), ...f2dot14(e)]))];
  const subs = datas.map((d) => [...u16(d.items.length), ...u16(d.items.length ? d.regions.length : 0), ...u16(d.regions.length), ...d.regions.flatMap(u16), ...d.items.flatMap((it) => it.flatMap(u16))]);
  const head = 8 + datas.length * 4;
  const out = [...u16(1), ...u32(head), ...u16(datas.length)];
  let at = head + regionList.length;
  for (const s of subs) {
    out.push(...u32(at));
    at += s.length;
  }
  out.push(...regionList, ...subs.flat());
  return out;
}

export interface Cff2FontOptions {
  /** 字形 (GID 順) を差し替える */
  glyphs?: Partial<Record<number, Uint8Array>>;
  /** 縦書きの表 (vhea・vmtx・VVAR・VORG) を入れない */
  noVertical?: boolean;
  /** unitsPerEm (既定は 1000) */
  unitsPerEm?: number;
  /** 可変フォントの表 (fvar・HVAR・VVAR) を入れない (可変でない CFF2 の書体) */
  noVariations?: boolean;
}

/** 全体の部品 0: 数を 1 つ積むだけ (30 + 10·R0 + 6·R4。差分の組 1 の字から呼ぶ) */
const GSUBR0 = charString(30, 10, 6, 1, 'blend');
/** FD 1 の局所の部品 0: 左へ 20 の横線 */
const LSUBR0 = charString(-20, 'hlineto');

export const GLYPH_A = charString(50, -10, 10, 0, 0, 1, 'blend', 'hmoveto', 400, 700, -400, 90, -60, 200, 30, 0, 0, 0, 0, -90, 60, -200, -30, 3, 'blend', 'hlineto');
export const GLYPH_B = charString(
  100, 100, 'rmoveto',
  -107, 'callgsubr', 0, 50, 50, 0, 30, 'rrcurveto',
  -107, 'callsubr',
  10, 20, 30, 40, 'hvcurveto',
  10, 0, 10, 5, 10, 0, 10, 0, 10, -5, 10, 0, 50, 'flex',
  5, 5, -10, 20, 1, 2, 3, 4, 5, 6, 'rlinecurve',
  7, 10, 20, 30, 5, 'hhcurveto',
  10, 20, 30, 40, -3, 'vhcurveto',
  10, 10, 5, 10, 10, 10, 10, 'hflex',
  1, 2, 3, 4, 5, 6, 7, 8, 'rcurveline',
  3, 10, 20, 30, 40, 'vvcurveto',
  10, 5, 10, 5, 10, 10, 10, -3, 10, 'hflex1',
  5, 1, 5, 1, 5, 1, 5, -1, 5, -1, 9, 'flex1',
  10, 20, 30, 40, 50, 60, 70, 80, 'hvcurveto',
  -30, 20, -40, 'vlineto',
);
export const GLYPH_C = charString(0, 'vsindex', 200, 20, 0, 0, 0, 1, 'blend', 0, 'rmoveto', 100, 'hlineto', 100, 'vlineto');
export const GLYPH_D = charString(
  10, 5, 0, 0, 0, 1, 'blend', 20, 30, 20, 30, 20, 30, 20, 'hstemhm',
  10, 20, 30, 20, 30, 20, 30, 20, 30, 20, 'cntrmask', { raw: [0x15, 0x05] },
  'hintmask', { raw: [0x0e, 0x15] },
  100, 200, 'rmoveto', 300, 'hlineto',
  'hintmask', { raw: [0x1d, 0x0a] },
  300, 'vlineto', -300, 'hlineto',
);

/** 横の送り (既定) と、その差分 [R0, R1, R2] */
export const ADVANCES = [500, 500, 600, 600, 250, 600];
const ADVANCE_DELTAS = [[0, 0, 0], [80, -50, 200], [20, 0, 0], [0, 0, 0], [30, -20, 100], [0, 0, 0]];
/** 縦の送りの差分と、縦書きの原点の差分 [R0, R1, R2] */
const VADVANCE_DELTAS = [[0, 0, 0], [50, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const VORG_DELTAS = [[10, 0, 0], [20, 0, 0], [10, 0, 0], [10, 0, 0], [10, 0, 0], [10, 0, 0]];

function cff2Table(glyphs: Uint8Array[], upm: number): number[] {
  const gsubrs = index2([GSUBR0]);
  const store = itemVariationStore([
    { regions: [0, 1, 2, 3], items: [] },
    { regions: [0, 4], items: [] },
  ]);
  const varStore = [...u16(store.length), ...store];
  const charStrings = index2(glyphs);
  // FDSelect (形式 3): GID 0〜1 は FD 0、2〜4 は FD 1、5 は FD 0
  const fdSelect = [3, ...u16(3), ...u16(0), 0, ...u16(2), 1, ...u16(5), 0, ...u16(glyphs.length)];
  // Private: FD 0 は BlueValues・StdHW に blend。FD 1 は vsindex = 1、StdVW に blend、局所の部品
  const priv0 = [...num(-10), ...num(10), ...num(700), ...num(2), ...num(0), ...num(0), ...num(0), ...num(1), 23, ...num(10), 6, ...num(60), ...num(30), ...num(-10), ...num(0), ...num(0), ...num(1), 23, 10, ...[30, 0x0a, 0x03, 0x96, 0x25, 0xff], 12, 9];
  const priv1Body = [...num(1), 22, ...num(80), ...num(20), ...num(5), ...num(1), 23, 11];
  const priv1 = [...priv1Body, ...int32(priv1Body.length + 6), 19];
  const lsubrs = index2([LSUBR0]);
  const matrix = upm === 1000 ? [] : [...realNum(1 / upm), ...num(0), ...num(0), ...realNum(1 / upm), ...num(0), ...num(0), 12, 7];
  const topSize = matrix.length + 6 + 6 + 7 + 7;
  let at = 5 + topSize + gsubrs.length;
  const varStoreAt = at;
  at += varStore.length;
  const charStringsAt = at;
  at += charStrings.length;
  const fdSelectAt = at;
  at += fdSelect.length;
  const fdArrayLen = index2([new Uint8Array(11), new Uint8Array(11)]).length;
  const fdArrayAt = at;
  at += fdArrayLen;
  const priv0At = at;
  at += priv0.length;
  const priv1At = at;
  const fdArray = index2([new Uint8Array([...int32(priv0.length), ...int32(priv0At), 18]), new Uint8Array([...int32(priv1.length), ...int32(priv1At), 18])]);
  const top = [...matrix, ...int32(charStringsAt), 17, ...int32(varStoreAt), 24, ...int32(fdArrayAt), 12, 36, ...int32(fdSelectAt), 12, 37];
  if (top.length !== topSize) throw new Error('TopDICT size');
  return [2, 0, 5, ...u16(top.length), ...top, ...gsubrs, ...varStore, ...charStrings, ...fdSelect, ...fdArray, ...priv0, ...priv1, ...lsubrs];
}

/** DICT の実数 (2 進化 10 進) */
function realNum(v: number): number[] {
  const s = String(v);
  const nib: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '.') nib.push(0xa);
    else if (c === '-') nib.push(0xe);
    else if (c === 'e') {
      if (s[i + 1] === '-') {
        nib.push(0xc);
        i++;
      } else nib.push(0xb);
    } else nib.push(+c);
  }
  nib.push(0xf);
  if (nib.length % 2) nib.push(0xf);
  const out = [30];
  for (let i = 0; i < nib.length; i += 2) out.push((nib[i] << 4) | nib[i + 1]);
  return out;
}

function sfnt(tables: Record<string, number[]>): ArrayBuffer {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  let size = 12 + n * 16;
  for (const t of tags) size += (tables[t].length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x4f54544f);
  dv.setUint16(4, n);
  let off = 12 + n * 16;
  tags.forEach((t, i) => {
    const rec = 12 + i * 16;
    out.set(tag(t), rec);
    dv.setUint32(rec + 8, off);
    dv.setUint32(rec + 12, tables[t].length);
    out.set(tables[t], off);
    off += (tables[t].length + 3) & ~3;
  });
  return out.buffer;
}

/** テスト用の CFF2 の可変フォント */
export function buildCff2Font(opts: Cff2FontOptions = {}): ArrayBuffer {
  const upm = opts.unitsPerEm ?? 1000;
  const glyphs = [new Uint8Array(0), GLYPH_A, GLYPH_B, GLYPH_C, new Uint8Array(0), GLYPH_D].map((g, i) => opts.glyphs?.[i] ?? g);
  const n = glyphs.length;
  const head = [...u32(0x00010000), ...u32(0x00010000), ...u32(0), ...u32(0x5f0f3cf5), ...u16(0x0003), ...u16(upm), ...new Array(16).fill(0), ...u16(0), ...u16(0), ...u16(1000), ...u16(1000), ...u16(0), ...u16(8), ...u16(2), ...u16(0), ...u16(0)];
  const hhea = [...u32(0x00010000), ...u16(880), ...u16(-120 & 0xffff), ...u16(0), ...u16(600), ...u16(0), ...u16(0), ...u16(600), ...u16(1), ...u16(0), ...u16(0), ...new Array(8).fill(0), ...u16(0), ...u16(n)];
  const maxp = [...u32(0x00005000), ...u16(n)];
  const hmtx = ADVANCES.flatMap((a) => [...u16(a), ...u16(0)]);
  const os2 = new Array(96).fill(0);
  const set16 = (o: number, v: number) => os2.splice(o, 2, ...u16(v & 0xffff));
  set16(0, 4);
  set16(4, 400);
  set16(6, 5);
  set16(68, 880);
  set16(70, -120);
  set16(74, 880);
  set16(76, 120);
  set16(86, 500);
  set16(88, 700);
  // cmap (形式 12): 空白 → 4、A〜D → 1・2・3・5
  const groups = [[0x20, 0x20, 4], [0x41, 0x43, 1], [0x44, 0x44, 5]];
  const sub = [...u16(12), ...u16(0), ...u32(16 + groups.length * 12), ...u32(0), ...u32(groups.length), ...groups.flatMap((g) => g.flatMap(u32))];
  const cmap = [...u16(0), ...u16(1), ...u16(3), ...u16(10), ...u32(12), ...sub];
  const names: Array<[number, string]> = [[1, 'K2Test'], [2, 'Regular'], [4, 'K2Test'], [6, 'K2Test-Regular'], [256, 'Weight'], [257, 'Width'], [258, 'Bold']];
  const strings: number[] = [];
  const records: number[] = [];
  for (const [id, s] of names) {
    records.push(...u16(3), ...u16(1), ...u16(0x409), ...u16(id), ...u16(s.length * 2), ...u16(strings.length));
    for (const c of s) strings.push(0, c.charCodeAt(0));
  }
  const name = [...u16(0), ...u16(names.length), ...u16(6 + names.length * 12), ...records, ...strings];
  const post = [...u32(0x00030000), ...u32(0), ...u16(-100 & 0xffff), ...u16(50), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0)];
  const fvar = [
    ...u16(1), ...u16(0), ...u16(16), ...u16(2), ...u16(2), ...u16(20), ...u16(1), ...u16(12),
    ...tag('wght'), ...fixed(100), ...fixed(400), ...fixed(900), ...u16(0), ...u16(256),
    ...tag('wdth'), ...fixed(50), ...fixed(100), ...fixed(200), ...u16(0), ...u16(257),
    ...u16(258), ...u16(0), ...fixed(700), ...fixed(100),
  ];
  const hvarStore = itemVariationStore([{ regions: [0, 1, 2], items: ADVANCE_DELTAS }]);
  const HVAR = [...u16(1), ...u16(0), ...u32(20), ...u32(0), ...u32(0), ...u32(0), ...hvarStore];
  const tables: Record<string, number[]> = { head, hhea, maxp, hmtx, 'OS/2': os2, cmap, name, post, fvar, HVAR, CFF2: cff2Table(glyphs, upm) };
  if (!opts.noVertical) {
    tables.vhea = [...u32(0x00011000), ...u16(500), ...u16(-500 & 0xffff), ...u16(0), ...u16(1000), ...u16(0), ...u16(0), ...u16(1000), ...u16(0), ...u16(1), ...u16(0), ...new Array(8).fill(0), ...u16(0), ...u16(n)];
    // 上の空き (既定): 縦書きの原点 - 字の上の端。A は 850 - 700、ほかは 880 から
    tables.vmtx = [[1000, 880], [1000, 150], [1000, 500], [1000, 780], [1000, 880], [1000, 380]].flatMap(([a, t]) => [...u16(a), ...u16(t)]);
    tables.VORG = [...u16(1), ...u16(0), ...u16(880), ...u16(1), ...u16(1), ...u16(850)];
    // VVAR: 送りの差分は項目 0〜5 (字の番号のまま)、縦書きの原点の差分は項目 6〜11 (vOrgMapping で引く)
    const vvarStore = itemVariationStore([{ regions: [0, 1, 2], items: [...VADVANCE_DELTAS, ...VORG_DELTAS] }]);
    const vorgMap = [0, 0x07, ...u16(n), ...glyphs.map((_, g) => 6 + g)];
    tables.VVAR = [...u16(1), ...u16(0), ...u32(24), ...u32(0), ...u32(0), ...u32(0), ...u32(24 + vvarStore.length), ...vvarStore, ...vorgMap];
  }
  if (opts.noVariations) for (const t of ['fvar', 'HVAR', 'VVAR']) delete tables[t];
  return sfnt(tables);
}
