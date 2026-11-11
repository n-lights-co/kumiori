/**
 * fontkitCffFlex — @pdf-lib/fontkit が、CFF の字形を誤って読む 2 つの所を正す (1. hflex・hflex1、2. FDSelect の範囲)。
 *
 * ── 1. hflex・hflex1 ──
 *
 * hflex・hflex1 は、浅い曲線を 2 本のベジエ曲線で書く命令で、引数を省く代わりに、次の点の y が同じと決まっている
 * (The Type 2 Charstring Format (Adobe Technical Note #5177) §4.1 の hflex・hflex1 の条件 a・b。OpenType 仕様
 *  「CFF2 — Compact Font Format (CFF) Version 2」の「CharString operators」の「Flex mechanism operators」も、同じ番号
 *  (12 34・12 36)・同じ引数・同じ条件):
 *  - hflex [dx1 dx2 dy2 dx3 dx4 dx5 dx6]: 「始点・終点・最初の制御点・最後の制御点の y が同じ」「つなぎ目と、その両隣の制御点の y が同じ」
 *  - hflex1 [dx1 dy1 dx2 dy2 dx3 dx4 dx5 dy5 dx6]: 「始点と終点の y が同じ」「つなぎ目と、その両隣の制御点の y が同じ」
 * fontkit の CFFGlyph の _getPath は、hflex の最後の制御点と終点の y、hflex1 の終点の y を、始点の y に戻さない
 * (つなぎ目・最後の制御点の y のままにする)。字形の命令は前の点からの差で書かれるので、その字形の、その命令より後の点が
 * すべて同じだけ縦にずれ、輪郭がゆがむ (字形の外接枠 bbox・cbox も変わる)。
 *
 * 直し方: CFF (版 1) の字形の _getPath を 1 回差し替える。fontkit の元の読みをそのまま行い、同じ字形を自前の Type 2 の読み
 * (psCff.ts。hflex・hflex1 を上の定義のとおりに読む) でも実行して、その字形が hflex か hflex1 を実行したときだけ、
 * 自前の読みの輪郭を fontkit の Path に直して返す。hflex・hflex1 を使わない字形は、fontkit の元の結果をそのまま返す
 * (flex・flex1 を含めて、これまでと同じ輪郭。fontkit の flex・flex1 の読みは #5177 §4.1 のとおり: flex1 の最後の点は、
 * 5 点目までの動きが横に長ければ x が d6 で y は始点の y、そうでなければ x は始点の x で y が d6)。
 * fontkit は字形ごとに輪郭を覚えるので、読むのは字形ごとに 1 回。
 *
 * 変えないもの:
 *  - CFF2 の字形 (fontkit が可変の値を混ぜて読む経路)・TrueType の字形
 *  - 自前の読みで読めない字形 (部分の命令が無い・命令が多すぎるなど) と、endchar の 4 つの数で 2 つの字を重ねる字形
 *    (seac。#5177 付録 C。fontkit は重ねる字を描かないので、輪郭の中身が変わってしまう)。どちらも fontkit の元の結果を返す
 *  - PDF に埋め込む書体 (cff.ts の部分書体は、字形の命令のバイト列をそのまま写すので、輪郭の読みを通らない)
 *
 * ── 2. FDSelect の範囲 (CID 方式の書体) ──
 *
 * CID 方式の CFF の書体は、字形ごとに FD (Font DICT。Private DICT と局所の部分の命令を持つ) を FDSelect で選ぶ。
 * FDSelect の形式 3 は、範囲の並びで、「範囲は、その first の字から、次の範囲の first の手前の字まで」。最初の範囲の first は 0 で、
 * 最後の範囲の後ろに、字の数に等しい番兵の番号が続く (The Compact Font Format Specification (Adobe Technical Note #5176) §19 の
 * 表 28 (Format 3)・表 29 (Range3 Format)。OpenType 仕様「CFF2」の「FontDICTSelect」の形式 3 の「Range3 record」も同じ決まりで、
 * CFF2 だけにある形式 4 は、同じ並びを 4 バイトの番号で書いたもの)。
 * fontkit の CFFFont の fdForGlyph は、二分探索で「次の範囲の first より大きい」ときだけ後ろへ進むので、範囲の最初の字が、
 * 前の範囲の FD になることがある (探索が前の範囲に当たったとき)。その字形は、違う Private DICT の局所の部分の命令で読まれ、
 * 輪郭がまったく別の形になるか、読めずに例外になる (Noto Sans JP の .otf の「:」「・」「※」など 29 字)。
 * fdForGlyph を、形式 3・4 のときに「first が字の番号以下の、最後の範囲」を引くものに差し替える (ほかは fontkit の元のまま)。
 * CFF2 の書体も同じ fdForGlyph を通るので、同じく正しくなる (CFF2 の字形の輪郭の読み方は変えない)。
 */
import { cffGlyph, parseCff } from './psCff';
import type { CffFont, Type2Info } from './psCff';

/** 差し替え済みの印 (原型に付ける。pdfLibPatches.ts と同じく、同じ fontkit を複数回読み込んでも二重に包まない) */
const PATCHED = Symbol.for('kumiori.fontkitCffFlexPatched');

interface FkPath {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): unknown;
  closePath(): unknown;
}

interface FkTable {
  offset: number;
  length: number;
}

/** fontkit の CFFFont (CFF・CFF2 の表を読んだもの) */
interface FkCff {
  topDict?: { FDSelect?: { version?: number; ranges?: ArrayLike<{ first: number; fd: number }> } | null };
  fdForGlyph?(gid: number): number | null;
  [PATCHED]?: boolean;
}

interface FkFont {
  'CFF '?: FkCff;
  CFF2?: FkCff;
  directory?: { tables?: Record<string, FkTable | undefined> };
  stream?: { buffer?: Uint8Array };
  _getBaseGlyph?(gid: number): object | null;
}

interface FkCffGlyph {
  id: number;
  _font: FkFont;
}

/** 書体ごとの、自前で読んだ CFF の表 (読むのは 1 回。読めなければ null) */
const parsed = new WeakMap<object, CffFont | null>();

function cffOf(font: FkFont): CffFont | null {
  let c = parsed.get(font);
  if (c !== undefined) return c;
  c = null;
  const t = font.directory?.tables?.['CFF '];
  const buf = font.stream?.buffer;
  if (t && buf && t.offset + t.length <= buf.length) {
    const f = parseCff(buf.subarray(t.offset, t.offset + t.length))[0];
    // Type 2 の字形の命令だけ (CharstringType の既定は 2)
    if (f && f.charstringType === 2) c = f;
  }
  parsed.set(font, c);
  return c;
}

/**
 * CFFFont の fdForGlyph を、FDSelect の形式 3・4 の範囲を正しく引くものに差し替える (原型に 1 回)。
 * CFF の表が読めない書体では何もしない (字形を読むときにもう 1 度試す)
 */
function patchFdForGlyph(font: FkFont) {
  let proto: FkCff | null;
  try {
    const t = font.directory?.tables;
    const cff = t?.['CFF '] ? font['CFF '] : t?.CFF2 ? font.CFF2 : undefined;
    proto = cff ? (Object.getPrototypeOf(cff) as FkCff | null) : null;
  } catch {
    return;
  }
  if (!proto || proto[PATCHED]) return;
  if (!Object.prototype.hasOwnProperty.call(proto, 'fdForGlyph') || typeof proto.fdForGlyph !== 'function') throw new Error('@pdf-lib/fontkit の CFF の fdForGlyph が見つかりません (fontkit の版が変わり、fontkitCffFlex.ts の差し替えが合いません)');
  const orig = proto.fdForGlyph;
  proto.fdForGlyph = function (this: FkCff, gid: number) {
    const sel = this.topDict?.FDSelect;
    const ranges = sel && (sel.version === 3 || sel.version === 4) ? sel.ranges : undefined;
    if (ranges && Number.isInteger(gid)) {
      // first が gid 以下の、最後の範囲 (範囲は first の昇順)
      let lo = 0;
      let hi = ranges.length - 1;
      let at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ranges[mid].first <= gid) {
          at = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (at >= 0) return ranges[at].fd;
    }
    // FDSelect が無い・形式 0・どの範囲にも入らない字は、fontkit の元のまま
    return orig.call(this, gid);
  };
  proto[PATCHED] = true;
}

/**
 * fontkit の CFF の字形の読みを正す: CFF (版 1) の字形の輪郭の hflex・hflex1 と、CID 方式の書体 (CFF・CFF2) の FDSelect の範囲。
 * 原型 (prototype) を 1 回差し替えれば、同じ fontkit のすべての CFF・CFF2 の書体に効く。CFF・CFF2 の表の無い書体には何もしない
 */
export function patchFontkitCffFlex(fk: unknown) {
  const font = fk as FkFont;
  let tables: Record<string, FkTable | undefined> | undefined;
  try {
    tables = font.directory?.tables;
  } catch {
    return;
  }
  // TrueType の書体からは、原型を取らない。CFF2 の書体の字形も同じ型 (CFFGlyph) なので、CFF2 の書体しか読まないときも当てておく
  // (CFF2 から作り直した静的な CFF の実体に効く。CFF2 の字形そのものの輪郭は、下で fontkit の元の結果を返す)
  if ((!tables?.['CFF '] && !tables?.CFF2) || tables.glyf) return;
  patchFdForGlyph(font);
  if (typeof font._getBaseGlyph !== 'function') throw new Error('@pdf-lib/fontkit の書体の _getBaseGlyph が見つかりません (fontkit の版が変わり、fontkitCffFlex.ts の差し替えが合いません)');
  const glyph = font._getBaseGlyph(0);
  const proto = (glyph ? Object.getPrototypeOf(glyph) : null) as { _getPath?: (this: FkCffGlyph) => FkPath; [PATCHED]?: boolean } | null;
  if (proto?.[PATCHED]) return;
  if (!proto || !Object.prototype.hasOwnProperty.call(proto, '_getPath') || typeof proto._getPath !== 'function') throw new Error('@pdf-lib/fontkit の CFF の字形の _getPath が見つかりません (fontkit の版が変わり、fontkitCffFlex.ts の差し替えが合いません)');
  const orig = proto._getPath;
  proto._getPath = function () {
    // 書体を読んだときに CFF の表が読めず、FDSelect の引き方を差し替えられなかったときのために、ここでも試す
    try {
      patchFdForGlyph(this._font);
    } catch {
      // 差し替えられなければ、fontkit の元の引き方のまま
    }
    // fontkit の元の読みは、いつも行う (使った部分の命令の控えなど、輪郭のほかに残すものを変えない。例外もそのまま)
    const path = orig.call(this);
    try {
      const t = this._font.directory?.tables;
      // CFF2 (同じ字形の型を通る) は変えない
      if (!t?.['CFF '] || t.CFF2) return path;
      const cff = cffOf(this._font);
      if (!cff) return path;
      const info: Type2Info = {};
      const g = cffGlyph(cff, this.id, info);
      if (!g || !info.hflex || info.seac) return path;
      // 自前の読みの輪郭 (M・L・C・Z。輪郭の閉じ方は fontkit と同じ: 次の輪郭の始まりと字形の終わりで閉じる) を fontkit の Path に直す
      const fixed = new (path.constructor as new () => FkPath)();
      for (const s of g.segs) {
        if (s.op === 'M') fixed.moveTo(s.x, s.y);
        else if (s.op === 'L') fixed.lineTo(s.x, s.y);
        else if (s.op === 'C') fixed.bezierCurveTo(s.x1, s.y1, s.x2, s.y2, s.x, s.y);
        else fixed.closePath();
      }
      return fixed;
    } catch {
      return path;
    }
  };
  proto[PATCHED] = true;
}
