/**
 * fontSanity — 書体のファイルを登録するとき (fontManager.ts の registerBuffer) の検査と、fontkit の読みに掛ける手間の上限。
 *
 * @pdf-lib/fontkit は、表を「使うとき」に読む。壊れた・細工した書体は、登録は通って、組む途中で例外になり (文書の全体が失敗する)、
 * あるいは、小さな表から、上限なしに大きな読み (配列の数 × 参照の入れ子) を始めて、時間とメモリを使い切る。ここでは:
 *  1. checkFontFile: 表の目録と、組むのに必ず使う表 (head・hhea・maxp・hmtx・cmap・name・post と輪郭の表) の形を、fontkit に渡す前に確かめる。
 *     だめなら FontFileError (呼ぶ側は、その書体を「読めない書体」として使わない)。複合の字形 (glyf) の、部品の展開が大きすぎるものは空にする
 *  2. probeFont: fontkit で、使う表を読みの回数の予算つきで読んでみる。予算を超える表 (GSUB・GPOS・GDEF など) は、外して登録し直す
 *  3. patchFontkitCffBudget: CFF・CFF2 の字形の輪郭 (Type 2 の CharString) の読みに、読むバイトの数の上限を置く
 *  4. patchLookupBudget: GSUB・GPOS の、文脈の Lookup から呼ぶ Lookup の回数と入れ子に上限を置く
 * 上限は、正当な書体が届かない値 (表の大きさに比例する値) にする。根拠は、それぞれの所に書く
 */
import { msg } from './messages';
import { FontFileError } from './fontLoader';

const tagAt = (dv: DataView, o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

interface Rec {
  tag: string;
  offset: number;
  length: number;
}

/** 書体について利用者に知らせる文の出し先を、fontkit の書体に付けるときの名前 (fontManager.ts が付ける。無ければ知らせない) */
export const FONT_NOTICE = Symbol.for('kumiori.fontNotice');

/** fontkit の書体 fk に付いた出し先に、知らせ message を出す (書体と種類 kind ごとに 1 度だけ) */
export function fontNotice(fk: unknown, kind: string, message: () => string) {
  const f = fk as { [FONT_NOTICE]?: (m: string) => void } | null;
  const out = f?.[FONT_NOTICE];
  if (!f || typeof out !== 'function') return;
  let kinds = noticed.get(f);
  if (!kinds) noticed.set(f, (kinds = new Set()));
  if (kinds.has(kind)) return;
  kinds.add(kind);
  try {
    out(message());
  } catch {
    // 知らせの出し先の誤りは、組版に持ち込まない
  }
}
const noticed = new WeakMap<object, Set<string>>();

/** 組むのに必ず使う表 (無い・読めない書体は使えない)。name・post は、PDF への埋め込み (pdf-lib の CustomFontEmbedder) が名前と italicAngle を読む */
const ESSENTIAL = ['head', 'hhea', 'maxp', 'hmtx', 'cmap', 'name', 'post'];
/** 輪郭の表 (目録にあるなら、ファイルに収まっていること) */
const OUTLINES = ['glyf', 'loca', 'CFF ', 'CFF2'];

/**
 * 複合の字形 (glyf の Composite Glyph Description) の、部品を展開した点の数・部品の数の上限 (字形 1 つ)。
 * TrueType の点の番号は 16 ビット (glyf の endPtsOfContours、maxp の maxPoints・maxCompositePoints・maxComponentElements は uint16) なので、
 * 正当な字形は 65535 を超えない
 */
const MAX_GLYPH_POINTS = 65535;
/** 部品の入れ子の上限 (maxp の maxComponentDepth は、ふつう 1〜3。HarfBuzz の HB_MAX_NESTING_LEVEL と同じ 64) */
const MAX_COMPONENT_DEPTH = 64;
/**
 * 書体の全体で、複合の字形を展開した点の合計の上限: glyf の表の 1 バイトあたり 64 点 + 400 万点。
 * 正当な書体は、単純な字形が 1 点に 1 バイト以上、複合の字形 (アクセント付きの字・ハングルの音節など) が 20 バイトほどで 100〜200 点なので、
 * 1 バイトあたり 10 点に届かない
 */
const COMPOSITE_POINTS_PER_BYTE = 64;
const COMPOSITE_POINTS_BASE = 4_000_000;

const bad = (ja: string, en: string) => new FontFileError(msg(`読めない書体です (${ja})`, `the font cannot be read (${en})`));

/** 表の集まりを sfnt にする (表は札の順、4 バイト境界)。検査で外した表を除いた書体を作るのに使う (表の中身は変えない) */
function rebuild(buffer: ArrayBuffer, keep: Rec[]): ArrayBuffer {
  const src = new Uint8Array(buffer);
  const recs = [...keep].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = recs.length;
  let size = 12 + n * 16;
  for (const r of recs) size += (r.length + 3) & ~3;
  const file = new Uint8Array(size);
  const fd = new DataView(file.buffer);
  const sd = new DataView(buffer);
  fd.setUint32(0, sd.getUint32(0));
  fd.setUint16(4, n);
  const log = Math.floor(Math.log2(Math.max(1, n)));
  fd.setUint16(6, 2 ** log * 16);
  fd.setUint16(8, log);
  fd.setUint16(10, n * 16 - 2 ** log * 16);
  let off = 12 + n * 16;
  recs.forEach((r, i) => {
    const at = 12 + i * 16;
    for (let k = 0; k < 4; k++) file[at + k] = r.tag.charCodeAt(k);
    // 表の検査合計は、元の目録の値のまま (表の中身は変えていない)
    fd.setUint32(at + 4, r.sum ?? 0);
    fd.setUint32(at + 8, off);
    fd.setUint32(at + 12, r.length);
    file.set(src.subarray(r.offset, r.offset + r.length), off);
    off += (r.length + 3) & ~3;
  });
  return file.buffer;
}
interface Rec {
  sum?: number;
}

function directory(buffer: ArrayBuffer): Rec[] | undefined {
  const dv = new DataView(buffer);
  if (buffer.byteLength < 12) throw bad('ファイルが短すぎる', 'the file is too short');
  const ver = dv.getUint32(0);
  // sfnt でないもの (知らない形式) は、fontkit の誤り (Unknown font format) に任せる
  if (ver !== 0x00010000 && ver !== 0x4f54544f && ver !== 0x74727565) return undefined;
  const n = dv.getUint16(4);
  if (12 + n * 16 > buffer.byteLength) throw bad('表の目録が切れている', 'the table directory is truncated');
  const recs: Rec[] = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    recs.push({ tag: tagAt(dv, o), sum: dv.getUint32(o + 4), offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) });
  }
  return recs;
}

/** 書体のファイル buffer から、札 tags の表を外した書体 (目録に無い札は無視)。sfnt でなければ、そのまま */
export function dropTables(buffer: ArrayBuffer, tags: readonly string[]): ArrayBuffer {
  const recs = directory(buffer);
  if (!recs) return buffer;
  const keep = recs.filter((r) => !tags.includes(r.tag) && r.offset + r.length <= buffer.byteLength);
  return keep.length === recs.length ? buffer : rebuild(buffer, keep);
}

export interface CheckedFont {
  /** 検査を通った書体 (直す所が無ければ、渡されたものそのまま) */
  buffer: ArrayBuffer;
  /** 利用者に知らせること (外した表・空にした字形)。無ければ空 */
  notes: string[];
}

/**
 * 書体のファイル (単独の sfnt) の形を確かめる。使えない書体は FontFileError。
 *  - 表の目録がファイルに収まること。必ず使う表 (ESSENTIAL) と、目録にある輪郭の表が、ファイルに収まること
 *    (ほかの表で、ファイルの外を指すものは、外す)
 *  - head の unitsPerEm が 0 でないこと、maxp の字形の数・hhea の送りの数が 1 以上で、hmtx がその数だけあること
 *  - TrueType の輪郭: loca が字形の数 + 1 個あり、昇順で、glyf に収まること (OpenType の 'loca' の表: 位置は昇順。字形の長さは次との差)。
 *    昇順でない loca は、複数の字形に同じデータを指させられる (小さな glyf から、字形の数 × 点の数の手間を作れる)
 *  - 複合の字形: 部品を展開した点の数・部品の数が上限を超えるもの、部品が輪になる・深すぎるものは、輪郭の無い字形に書き換える
 *    (字形 i が字形 i−1 を 2 つ持つ鎖で、点の数が 2 の n 乗になる。fontkit の _getContours も、実体を作るとき (fontInstancer.ts) も、
 *    部品をそのまま展開する)。送りは変えない
 */
export function checkFontFile(buffer: ArrayBuffer): CheckedFont {
  const recs = directory(buffer);
  if (!recs) return { buffer, notes: [] };
  const notes: string[] = [];
  const dv = new DataView(buffer);
  const size = buffer.byteLength;
  const inFile = (r: Rec) => r.offset + r.length <= size;
  const byTag = new Map<string, Rec>();
  for (const r of recs) if (!byTag.has(r.tag)) byTag.set(r.tag, r);
  for (const tag of ESSENTIAL) {
    const r = byTag.get(tag);
    if (!r) throw bad(`${tag.trim()} の表が無い`, `no ${tag.trim()} table`);
    if (!inFile(r)) throw bad(`${tag.trim()} の表がファイルの外を指している`, `the ${tag.trim()} table lies outside the file`);
  }
  for (const tag of OUTLINES) {
    const r = byTag.get(tag);
    if (r && !inFile(r)) throw bad(`${tag.trim()} の表がファイルの外を指している`, `the ${tag.trim()} table lies outside the file`);
  }
  const outside = recs.filter((r) => !inFile(r)).map((r) => r.tag);
  if (outside.length) {
    notes.push(msg(`ファイルの外を指す表 (${outside.join('・')}) を使いません`, `tables lying outside the file (${outside.join(', ')}) are not used`));
    buffer = rebuild(buffer, recs.filter(inFile));
    return { buffer: checkFontFile(buffer).buffer, notes };
  }
  const head = byTag.get('head')!;
  const hhea = byTag.get('hhea')!;
  const maxp = byTag.get('maxp')!;
  const hmtx = byTag.get('hmtx')!;
  if (head.length < 54) throw bad('head の表が短い', 'the head table is too short');
  if (dv.getUint16(head.offset + 18) === 0) throw bad('unitsPerEm が 0', 'unitsPerEm is 0');
  if (maxp.length < 6) throw bad('maxp の表が短い', 'the maxp table is too short');
  const numGlyphs = dv.getUint16(maxp.offset + 4);
  if (numGlyphs === 0) throw bad('字形が 1 つも無い', 'the font has no glyphs');
  if (hhea.length < 36) throw bad('hhea の表が短い', 'the hhea table is too short');
  const numH = dv.getUint16(hhea.offset + 34);
  if (numH === 0 || hmtx.length < numH * 4) throw bad('hmtx の表が、送りの数に足りない', 'the hmtx table is shorter than the number of metrics');
  const glyf = byTag.get('glyf');
  const loca = byTag.get('loca');
  if (!glyf || !loca) return { buffer, notes };

  const long = dv.getInt16(head.offset + 50) !== 0;
  if (loca.length < (numGlyphs + 1) * (long ? 4 : 2)) throw bad('loca の表が、字形の数に足りない', 'the loca table is shorter than the number of glyphs');
  const offsets = new Uint32Array(numGlyphs + 1);
  for (let g = 0; g <= numGlyphs; g++) {
    const o = long ? dv.getUint32(loca.offset + g * 4) : dv.getUint16(loca.offset + g * 2) * 2;
    if (o > glyf.length || (g > 0 && o < offsets[g - 1])) throw bad('loca の表の位置が、昇順でないか、glyf の外を指している', 'offsets in the loca table are not ascending or lie outside glyf');
    offsets[g] = o;
  }

  // 字形ごとの、点の数 (単純な字形) と、部品の並び (複合の字形)
  const points = new Float64Array(numGlyphs);
  const comps = new Float64Array(numGlyphs);
  const firstChild = new Int32Array(numGlyphs + 1);
  const children: number[] = [];
  let anyComposite = false;
  for (let g = 0; g < numGlyphs; g++) {
    firstChild[g] = children.length;
    const a = glyf.offset + offsets[g];
    const end = glyf.offset + offsets[g + 1];
    if (end - a < 10) continue;
    const nc = dv.getInt16(a);
    if (nc >= 0) {
      if (nc > 0 && a + 10 + nc * 2 <= end) points[g] = dv.getUint16(a + 10 + (nc - 1) * 2) + 1;
      continue;
    }
    anyComposite = true;
    let p = a + 10;
    for (;;) {
      if (p + 4 > end) break;
      const flags = dv.getUint16(p);
      children.push(dv.getUint16(p + 2));
      p += 4 + (flags & 0x0001 ? 4 : 2) + (flags & 0x0008 ? 2 : flags & 0x0040 ? 4 : flags & 0x0080 ? 8 : 0);
      if (!(flags & 0x0020)) break;
    }
  }
  firstChild[numGlyphs] = children.length;
  if (!anyComposite) return { buffer, notes };

  // 展開した点の数・部品の数を、字形ごとに 1 度だけ数える (0: まだ、1: 数えている途中、2: 済み)
  const state = new Uint8Array(numGlyphs);
  const emptied: number[] = [];
  const count = (g: number, depth: number) => {
    if (state[g] === 2) return;
    state[g] = 1;
    let pts = 0;
    let cps = 0;
    let broken = depth > MAX_COMPONENT_DEPTH;
    for (let k = firstChild[g]; k < firstChild[g + 1] && !broken; k++) {
      const c = children[k];
      if (c >= numGlyphs) continue;
      if (state[c] === 1) {
        // 部品が輪になっている
        broken = true;
        break;
      }
      if (state[c] === 0) count(c, depth + 1);
      pts += points[c];
      cps += 1 + comps[c];
      if (pts > MAX_GLYPH_POINTS || cps > MAX_GLYPH_POINTS) broken = true;
    }
    if (broken) {
      emptied.push(g);
      pts = 0;
      cps = 0;
    }
    if (firstChild[g] < firstChild[g + 1]) {
      points[g] = pts;
      comps[g] = cps;
    }
    state[g] = 2;
  };
  const budget = COMPOSITE_POINTS_PER_BYTE * glyf.length + COMPOSITE_POINTS_BASE;
  let total = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (firstChild[g] === firstChild[g + 1]) continue;
    count(g, 0);
    total += points[g];
    if (total > budget && points[g] > 0) {
      // 書体の全体の予算を超えた後の複合の字形は、空にする (字形 1 つは小さくても、6 万の字形がそれぞれ 6 万点に展開される書体を作れる)
      total -= points[g];
      emptied.push(g);
      points[g] = 0;
      comps[g] = 0;
    }
  }
  if (!emptied.length) return { buffer, notes };
  const out = buffer.slice(0);
  const od = new DataView(out);
  for (const g of emptied) {
    // 輪郭の無い単純な字形 (numberOfContours = 0、外接の箱は 0、命令の長さ 0) に書き換える。複合の字形は 16 バイト以上ある
    const a = glyf.offset + offsets[g];
    const len = offsets[g + 1] - offsets[g];
    for (let k = 0; k < Math.min(12, len); k++) od.setUint8(a + k, 0);
  }
  notes.push(
    msg(
      `部品の展開が大きすぎる・輪になっている複合の字形 ${emptied.length} 個を、空の字形として扱います`,
      `${emptied.length} composite glyph(s) whose components expand too far or form a cycle are treated as empty glyphs`,
    ),
  );
  return { buffer: out, notes };
}

// ---- fontkit の読みの回数の予算 ----

interface Counter {
  n: number;
  cap: number;
  on: boolean;
  over: boolean;
}
type FkStream = Record<string, unknown>;
const counters = new WeakMap<object, Counter>();

/** 読みの予算を超えたときの誤り */
class ReadBudgetError extends Error {}

/**
 * fontkit の書体の読み口 (DecodeStream。表の読みは、どれもこの 1 つの読み口の read… を通る) に、読みの回数を数える包みを掛ける。
 * 数えるのは on の間だけ。cap を超えたら、over を立てて ReadBudgetError を投げる
 */
function counterOf(stream: FkStream): Counter {
  let c = counters.get(stream);
  if (c) return c;
  const counter: Counter = (c = { n: 0, cap: Infinity, on: false, over: false });
  for (let p = Object.getPrototypeOf(stream) as Record<string, unknown> | null; p && p !== Object.prototype; p = Object.getPrototypeOf(p) as Record<string, unknown> | null) {
    for (const k of Object.getOwnPropertyNames(p)) {
      if (!k.startsWith('read') || Object.prototype.hasOwnProperty.call(stream, k)) continue;
      const f = p[k];
      if (typeof f !== 'function') continue;
      const bulk = k === 'readBuffer' || k === 'readString';
      stream[k] = function (this: unknown, a: unknown, b: unknown) {
        if (counter.on) {
          counter.n += bulk && typeof a === 'number' ? 1 + (a >>> 3) : 1;
          if (counter.n > counter.cap) {
            counter.over = true;
            throw new ReadBudgetError('font read budget exceeded');
          }
        }
        return (f as (a: unknown, b: unknown) => unknown).call(this, a, b);
      };
    }
  }
  counters.set(stream, counter);
  return counter;
}

/**
 * fn の間、読み口 stream の読みを cap 回までにする。戻り値: fn の結果・読んだ回数・予算を超えたか (fn の例外は error に入れる)。
 * 予算つきの読みの中から呼ばれたとき (入れ子): own が偽なら外の予算のまま (読んだ回数は 0 と返す)。own が真なら、fn の間だけ
 * 自分の予算で数え、終わったら外の予算に戻す (fn の読みは、外の予算に数えない。整形の中で CFF の字形の輪郭を読むときなど)
 */
function withReadBudget<T>(stream: FkStream, cap: number, fn: () => T, own = false): { value?: T; error?: unknown; reads: number; over: boolean } {
  const c = counterOf(stream);
  if (c.on && !own) {
    try {
      return { value: fn(), reads: 0, over: false };
    } catch (error) {
      return { error, reads: 0, over: c.over };
    }
  }
  const saved = c.on ? { n: c.n, cap: c.cap, over: c.over } : undefined;
  c.n = 0;
  c.cap = cap;
  c.over = false;
  c.on = true;
  try {
    return { value: fn(), reads: c.n, over: c.over };
  } catch (error) {
    return { error, reads: c.n, over: c.over };
  } finally {
    if (saved) Object.assign(c, saved);
    else c.on = false;
  }
}

/**
 * 表の読みの回数の上限: 表の 1 バイトあたり 16 回 + 4096 回。
 * fontkit は、表の構造 (配列の数・参照の先) をそのまま読むので、数の欄を大きくし、参照を同じ場所に重ねた表は、表の大きさと無関係に
 * 大きな読みになる (GSUB の 1 欄を 0x7FFF にした 500KB の書体で、2GB を超えて落ちた)。正当な書体は、表を 1 度ずつ読むので
 * 1 バイトあたり 0.3〜1 回、同じ部分表を共有する表 (詰めた GPOS) を全部読んでも 4 回ほど (手元の 164 書体の最大は 3.7 回)
 */
const READS_PER_BYTE = 16;
const READS_BASE = 4096;

/** 中身が大きく、fontkit が字形ごとに引く表 (全体を歩かない)。読めるかどうかは、字を引いて確かめる */
const BULK = new Set(['glyf', 'loca', 'CFF ', 'CFF2', 'gvar', 'SVG ', 'CBDT', 'CBLC', 'EBDT', 'EBLC', 'sbix', 'hmtx', 'vmtx', 'cmap', 'name', 'post', 'head', 'hhea', 'maxp', 'fpgm', 'prep', 'cvt ', 'DSIG']);

type ProbeFont = {
  stream?: FkStream;
  directory?: { tables?: Record<string, { length: number } | undefined> };
  numGlyphs?: number;
  getGlyph?(id: number): { advanceWidth?: number } | null;
  glyphForCodePoint?(cp: number): { id: number; advanceWidth?: number } | null;
  hasGlyphForCodePoint?(cp: number): boolean;
  layout?(text: string): unknown;
} & Record<string, unknown>;

/**
 * fontkit で読んだ書体 fk の、使う表を読んでみる。
 *  - 必ず使う表 (head・hhea・maxp・hmtx・cmap・name・post、輪郭が CFF なら CFF) と、書体の全体の値 (上下・名前・italicAngle など)、
 *    字を引くこと (cmap)、字の送り (hmtx) が読めなければ FontFileError
 *  - ほかの表 (GSUB・GPOS・GDEF・BASE・kern・morx・COLR・MATH など) は、fontkit が表を開くときに読む部分 (遅れて読む部分の外) を、
 *    読みの回数の予算つきで読む。予算を超えた表の札を返す (呼ぶ側が、その表を外して登録し直す)。
 *    遅れて読む部分 (Lookup・部分表) は、使うときに読みの予算 (withLayoutBudget) の中で読む。
 *    予算の中で読めない表は、これまでどおり (fontkit は、読めない表を無いものとして扱う)
 */
export function probeFont(fk: unknown): { over: string[] } {
  const font = fk as ProbeFont;
  const stream = font.stream;
  const tables = font.directory?.tables;
  if (!stream || !tables) return { over: [] };
  const over: string[] = [];
  const capOf = (tag: string) => READS_PER_BYTE * (tables[tag]?.length ?? 0) + READS_BASE;
  const fail = (what: string) => bad(`${what} を読めない`, `cannot read ${what}`);
  // 必ず使う表: 読めること
  const cff = tables['CFF '] ? 'CFF ' : tables.CFF2 ? 'CFF2' : undefined;
  for (const tag of [...ESSENTIAL, ...(tables.glyf && tables.loca ? ['loca'] : []), ...(cff ? [cff] : [])]) {
    const r = withReadBudget(stream, capOf(tag), () => font[tag]);
    if (r.error || r.over || r.value === undefined || r.value === null) throw fail(msg(`${tag.trim()} の表`, `the ${tag.trim()} table`));
  }
  // ほかの表: 開くときの読みを、予算つきで
  for (const tag of Object.keys(tables)) {
    if (BULK.has(tag)) continue;
    const r = withReadBudget(stream, capOf(tag), () => font[tag]);
    if (r.over) over.push(tag);
  }
  if (over.length) return { over };
  // 書体の全体の値と、字を引くこと・字の送り (壊れた表は、ここで例外になる)
  const r = withReadBudget(stream, READS_PER_BYTE * (tables.cmap?.length ?? 0) + (tables.hmtx?.length ?? 0) + 1_000_000, () => {
    for (const k of ['unitsPerEm', 'ascent', 'descent', 'lineGap', 'underlinePosition', 'underlineThickness', 'italicAngle', 'capHeight', 'xHeight', 'bbox', 'postscriptName', 'fullName', 'familyName', 'subfamilyName']) void font[k];
    const n = font.numGlyphs ?? 0;
    if (!(n > 0)) throw new Error('no glyphs');
    font.hasGlyphForCodePoint?.(0x20);
    for (const g of [font.getGlyph?.(0), font.getGlyph?.(n - 1), font.glyphForCodePoint?.(0x20), font.glyphForCodePoint?.(0x41), font.glyphForCodePoint?.(0x3042)]) {
      if (g && typeof g.advanceWidth !== 'number') throw new Error('no advance');
    }
    // 整形 (GSUB・GPOS・kern・morx) の表を開いておく。手間の上限を超えた表は、fontkitShaping.ts の包みが、整形の表を使わない形に落とす。
    // 欧字だけの短い並びも組めない書体 (壊れた整形の表で、どの字の並びも例外になる。文書の全体が失敗した) は、整形の表を使わない
    // (用字系の整形の途中の誤りは、ここでは出ないので、これまでどおり、組む所が扱う)
    try {
      font.layout?.('A fi 1');
    } catch (e) {
      if (disableLayoutTables(font))
        fontNotice(font, 'layout', () => msg(`整形の表 (GSUB・GPOS・morx) で字を組めません (${e instanceof Error ? e.message : String(e)})。この書体は、合字・カーニングなどの機能を使わずに組みます`, `cannot shape text with the layout tables (GSUB, GPOS, morx) (${e instanceof Error ? e.message : String(e)}); this font is set without ligatures, kerning or other features`));
      font.layout?.('A fi 1');
    }
  });
  if (r.error || r.over) throw fail(msg(`書体の値・字の表 (${r.error instanceof Error ? r.error.message : '読みが大きすぎる'})`, `font metrics or character tables (${r.error instanceof Error ? r.error.message : 'too much to read'})`));
  return { over: [] };
}

// ---- 整形の表の、遅れて読む部分の読みの上限 ----

/**
 * 整形 (layout) と、整形の表を直に引く所 (ligature.ts・mathFont.ts など) の読みの上限 (書体ごと、書体を使う間の合計):
 * 字形ごとに引く輪郭・画像の表 (glyf・CFF・gvar・SVG・CBDT など) を除いた表の大きさの 1 バイトあたり 16 回 + 100 万回。
 * fontkit は、Lookup・部分表などを、初めて使うときに読んで覚える (LazyArray・遅れて読む参照) ので、正当な書体の読みは、表の大きさに
 * 比例する (手元の書体で 1 バイトあたり 4 回まで)。壊れた数・重ねた参照の表は、初めて使うときに上限なしに展開する (GSUB の 1 欄を 0x7FFF に
 * した書体で 2GB を超えた) ので、予算を超えたら ReadBudgetError (呼ぶ側が、整形の表を使わない形に落とす)
 */
const LAYOUT_READS_PER_BYTE = 16;
const LAYOUT_READS_BASE = 1_000_000;
/** 字形ごとに引く表 (輪郭・画像。読みは、字形ごとの予算で数える) */
const GLYPH_DATA = new Set(['glyf', 'loca', 'CFF ', 'CFF2', 'gvar', 'SVG ', 'CBDT', 'CBLC', 'EBDT', 'EBLC', 'sbix', 'fpgm', 'prep', 'cvt ', 'DSIG', 'hdmx', 'VORG', 'LTSH']);
const layoutLeft = new WeakMap<object, number>();
const layoutBudgetOf = (font: ProbeFont) => {
  let bytes = 0;
  for (const [tag, t] of Object.entries(font.directory?.tables ?? {})) if (!GLYPH_DATA.has(tag)) bytes += t?.length ?? 0;
  return LAYOUT_READS_PER_BYTE * bytes + LAYOUT_READS_BASE;
};

/** 読みの予算を超えた (fontkit の表の読みが大きすぎる) ときの誤り */
export { ReadBudgetError };

/**
 * fn を、書体 fk の整形の表の読みの予算の中で呼ぶ。予算を超えたら ReadBudgetError (fn の例外は、そのまま投げる)。
 * fn の中の読みは、書体の予算から引く。fresh が真なら、予算を初めの値に戻してから呼ぶ (整形の表を止めた後の組み直し)
 */
export function withLayoutBudget<T>(fk: unknown, fn: () => T, fresh = false): T {
  const font = fk as ProbeFont;
  const stream = font?.stream;
  if (!stream) return fn();
  let left = fresh ? undefined : layoutLeft.get(font);
  if (left === undefined) left = layoutBudgetOf(font);
  const r = withReadBudget(stream, left, fn, true);
  layoutLeft.set(font, Math.max(0, left - r.reads));
  if (r.over) throw new ReadBudgetError('font read budget exceeded');
  if ('error' in r && r.error !== undefined) throw r.error;
  return r.value as T;
}

// ---- CFF・CFF2 の字形の輪郭の読みの上限 ----

const CFF_PATCHED = Symbol.for('kumiori.fontkitCffBudgetPatched');

/**
 * CFF・CFF2 の字形の輪郭 (CharString) の読みの上限 (読むバイトの数。部品 subr の中も数える):
 *  - 書体の全体 (字形ごとに、最初に読んだ分を数える): CFF の表の 1 バイトあたり 64 + 100 万。
 *    CharString は、部品 (callsubr・callgsubr) を何度でも呼べるので、「部品 k が部品 k−1 を 2 回呼ぶ」40 段の鎖 (1.4KB) で、2 の 40 乗の
 *    演算子になる。fontkit の CFFGlyph._getPath は、入れ子も回数も数えずに実行し、字の送りを読むだけでも走る。
 *    正当な書体は、部品にまとめた分を展開しても、表の大きさの数倍 (字形の CharString の合計は、表の大きさを超えない)。
 *    Type 2 の仕様 (Adobe Technical Note #5177「The Type 2 Charstring Format」の Appendix B) の実装の限界は、部品の入れ子 10 段
 *  - 字形 1 つ: 上の残りと、400 万の小さい方
 * 上限を超えた字形・読めない字形 (知らない演算子など。これまでは例外で文書の全体が失敗した) は、空の輪郭にして、1 度だけ知らせる
 */
const CFF_READS_PER_BYTE = 64;
const CFF_READS_BASE = 1_000_000;
const CFF_GLYPH_READS = 4_000_000;

interface CffState {
  left: number;
  seen: Set<number>;
  bad: Set<number>;
}
const cffStates = new WeakMap<object, CffState>();

type CffGlyph = { id: number; _font: ProbeFont; _usedSubrs?: object; _usedGsubrs?: object };

/** fontkit の CFF の字形の原型の _getPath を、読みの上限つきにする (fontkitCffFlex.ts の差し替えの外側に掛ける。原型に 1 回だけ) */
export function patchFontkitCffBudget(fk: unknown) {
  const font = fk as ProbeFont & { _getBaseGlyph?: (id: number) => object | null };
  let tables: Record<string, unknown> | undefined;
  try {
    tables = font.directory?.tables;
  } catch {
    return;
  }
  if ((!tables?.['CFF '] && !tables?.CFF2) || tables.glyf || typeof font._getBaseGlyph !== 'function') return;
  let glyph: object | null;
  try {
    glyph = font._getBaseGlyph(0);
  } catch {
    return;
  }
  type Proto = { _getPath?: (this: CffGlyph) => unknown; [CFF_PATCHED]?: boolean };
  const proto = (glyph ? Object.getPrototypeOf(glyph) : null) as Proto | null;
  if (!proto || proto[CFF_PATCHED] || !Object.prototype.hasOwnProperty.call(proto, '_getPath') || typeof proto._getPath !== 'function') return;
  const orig = proto._getPath;
  // 空の輪郭: 字形の基の型 (Glyph) の _getPath
  let base = Object.getPrototypeOf(proto) as Proto | null;
  while (base && !(Object.prototype.hasOwnProperty.call(base, '_getPath') && typeof base._getPath === 'function')) base = Object.getPrototypeOf(base) as Proto | null;
  const empty = base?._getPath;
  if (!empty) return;
  proto._getPath = function (this: CffGlyph) {
    const f = this._font;
    const stream = f.stream;
    if (!stream) return orig.call(this);
    let st = cffStates.get(f);
    if (!st) {
      const t = f.directory?.tables;
      const bytes = (t?.['CFF '] ?? t?.CFF2)?.length ?? 0;
      cffStates.set(f, (st = { left: CFF_READS_PER_BYTE * bytes + CFF_READS_BASE, seen: new Set(), bad: new Set() }));
    }
    const first = !st.seen.has(this.id);
    if (!st.bad.has(this.id)) {
      const pos = (stream as { pos?: number }).pos;
      const r = withReadBudget(stream, first ? Math.min(st.left, CFF_GLYPH_READS) : CFF_GLYPH_READS, () => orig.call(this), true);
      if (first) {
        st.seen.add(this.id);
        st.left = Math.max(0, st.left - r.reads);
      }
      if (!r.error && !r.over) return r.value;
      // 読みの途中で止めたので、読み口の位置を戻す
      if (typeof pos === 'number') (stream as { pos?: number }).pos = pos;
      st.bad.add(this.id);
      fontNotice(f, 'cff-glyph', () =>
        r.over
          ? msg('字形の輪郭 (CFF の CharString) の読みが大きすぎる字があります。その字は、空の字形として扱います', 'some glyph outlines (CFF CharStrings) take too much to read; those glyphs are treated as empty')
          : msg('字形の輪郭 (CFF の CharString) を読めない字があります。その字は、空の字形として扱います', 'some glyph outlines (CFF CharStrings) cannot be read; those glyphs are treated as empty'),
      );
    }
    this._usedSubrs = {};
    this._usedGsubrs = {};
    return empty.call(this);
  };
  proto[CFF_PATCHED] = true;
}

// ---- GSUB・GPOS の Lookup の呼び出しの上限 ----

const LOOKUP_PATCHED = Symbol.for('kumiori.fontkitLookupBudgetPatched');

/**
 * 文脈の Lookup (GSUB の 5・6、GPOS の 7・8) が呼ぶ Lookup の、1 回の整形 (layout の 1 回の呼び出し) での回数と入れ子の上限。
 * 文脈の Lookup は、当たった所で別の Lookup を呼び、呼ばれた Lookup も文脈の Lookup にできる。「Lookup i が Lookup i+1 を 3 回呼ぶ」14 段の鎖で、
 * 1 字につき 3 の 14 乗回の呼び出しになる (fontkit の applyLookupList は、入れ子も回数も数えない)。
 * OpenType の仕様に限界の定めは無いので、HarfBuzz の値に合わせる: 入れ子は 64 段 (HB_MAX_NESTING_LEVEL)、回数は 35000
 * (HB_MAX_LOOKUP_VISIT_COUNT) に、字形 1 つにつき 64 回 (HarfBuzz の max_ops の HB_BUFFER_MAX_OPS_FACTOR) を足した数。
 * 正当な書体の入れ子は 1〜3 段、呼び出しは、当たった所ごとに数回
 */
const MAX_LOOKUP_NESTING = 64;
const MAX_LOOKUP_CALLS = 35000;
const LOOKUP_CALLS_PER_GLYPH = 64;

/** 整形の Lookup の呼び出しが上限を超えたときの誤り (fontkitShaping.ts が、整形の表を使わない形に落とす) */
export class LookupBudgetError extends Error {}

let lookupCalls = 0;
let lookupDepth = 0;

/** 整形 (layout) の 1 回の呼び出しの初めに、Lookup の呼び出しの数を 0 に戻す */
export function resetLookupBudget() {
  lookupCalls = 0;
  lookupDepth = 0;
}

type Processor = { applyLookupList?: (this: { glyphs?: { length: number } }, records: { length: number }) => unknown; [LOOKUP_PATCHED]?: boolean };

/** fontkit の書体 fk の、GSUB・GPOS の処理の原型の applyLookupList に、回数と入れ子の上限を掛ける (原型に 1 回だけ) */
export function patchLookupBudget(fk: unknown) {
  const font = fk as { _layoutEngine?: { engine?: { GSUBProcessor?: object; GPOSProcessor?: object } | null } };
  let procs: Array<object | undefined>;
  try {
    const engine = font._layoutEngine?.engine;
    procs = [engine?.GSUBProcessor, engine?.GPOSProcessor];
  } catch {
    return;
  }
  for (const proc of procs) {
    let pp = proc ? (Object.getPrototypeOf(proc) as Processor | null) : null;
    while (pp && !Object.prototype.hasOwnProperty.call(pp, 'applyLookupList')) pp = Object.getPrototypeOf(pp) as Processor | null;
    if (!pp || pp[LOOKUP_PATCHED] || typeof pp.applyLookupList !== 'function') continue;
    const orig = pp.applyLookupList;
    pp.applyLookupList = function (records) {
      lookupCalls += records?.length ?? 0;
      if (lookupDepth >= MAX_LOOKUP_NESTING || lookupCalls > MAX_LOOKUP_CALLS + LOOKUP_CALLS_PER_GLYPH * (this.glyphs?.length ?? 0)) throw new LookupBudgetError('too many nested lookups');
      lookupDepth++;
      try {
        return orig.call(this, records);
      } finally {
        lookupDepth--;
      }
    };
    pp[LOOKUP_PATCHED] = true;
  }
}

const layoutDisabled = new WeakSet<object>();

/**
 * fontkit の書体 fk の整形の表 (GSUB・GPOS・morx・kern) を、以後使わないようにする (字は cmap の字形のまま、送りは hmtx のまま)。
 * 整形の途中で例外になる書体 (参照の先が無い表・呼び出しの多すぎる Lookup) を、文書の全体の失敗にしないために使う。
 * いま止めたら true (既に止めてあれば false)
 */
export function disableLayoutTables(fk: unknown): boolean {
  const font = fk as { _layoutEngine?: { engine?: unknown; kernProcessor?: unknown } };
  if (!font || layoutDisabled.has(font)) return false;
  layoutDisabled.add(font);
  try {
    const le = font._layoutEngine;
    if (!le) return false;
    le.engine = null;
    // kern の表 (GPOS の無い書体のカーニング) も使わない (fontkit の LayoutEngine.position は、kernProcessor があれば作り直さない)
    le.kernProcessor = { process() {} };
    return true;
  } catch {
    return false;
  }
}
