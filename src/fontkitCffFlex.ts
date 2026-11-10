/**
 * fontkitCffFlex — @pdf-lib/fontkit が、CFF の字形の hflex・hflex1 を誤って読むのを正す。
 *
 * hflex・hflex1 は、浅い曲線を 2 本のベジエ曲線で書く命令で、引数を省く代わりに、次の点の y が同じと決まっている
 * (OpenType 仕様「CFF2 — Compact Font Format (CFF) Version 2」の「CharString operators」の「Flex mechanism operators」。
 *  Type 2 の字形の命令 (CFF の版 1) でも、同じ番号 (12 34・12 36)・同じ引数の演算子):
 *  - hflex [dx1 dx2 dy2 dx3 dx4 dx5 dx6]: 「始点・終点・最初の制御点・最後の制御点の y が同じ」「つなぎ目と、その両隣の制御点の y が同じ」
 *  - hflex1 [dx1 dy1 dx2 dy2 dx3 dx4 dx5 dy5 dx6]: 「始点と終点の y が同じ」「つなぎ目と、その両隣の制御点の y が同じ」
 * fontkit の CFFGlyph の _getPath は、hflex の最後の制御点と終点の y、hflex1 の終点の y を、始点の y に戻さない
 * (つなぎ目・最後の制御点の y のままにする)。字形の命令は前の点からの差で書かれるので、その字形の、その命令より後の点が
 * すべて同じだけ縦にずれ、輪郭がゆがむ (字形の外接枠 bbox・cbox も変わる)。
 *
 * 直し方: CFF (版 1) の字形の _getPath を 1 回差し替える。fontkit の元の読みをそのまま行い、同じ字形を自前の Type 2 の読み
 * (psCff.ts。hflex・hflex1 を上の定義のとおりに読む) でも実行して、その字形が hflex か hflex1 を実行したときだけ、
 * 自前の読みの輪郭を fontkit の Path に直して返す。hflex・hflex1 を使わない字形は、fontkit の元の結果をそのまま返す
 * (flex・flex1 を含めて、これまでと同じ輪郭)。fontkit は字形ごとに輪郭を覚えるので、読むのは字形ごとに 1 回。
 *
 * 変えないもの:
 *  - CFF2 の字形 (fontkit が可変の値を混ぜて読む経路)・TrueType の字形
 *  - 自前の読みで読めない字形 (部分の命令が無い・命令が多すぎるなど) と、endchar の 4 つの数で 2 つの字を重ねる字形
 *    (seac。fontkit は重ねる字を描かないので、輪郭の中身が変わってしまう)。どちらも fontkit の元の結果を返す
 *  - PDF に埋め込む書体 (cff.ts の部分書体は、字形の命令のバイト列をそのまま写すので、輪郭の読みを通らない)
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

interface FkFont {
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
 * fontkit の CFF (版 1) の字形の輪郭の読みを、hflex・hflex1 を正しく読むものに差し替える。
 * 原型 (prototype) を 1 回差し替えれば、同じ fontkit のすべての CFF の書体に効く。CFF の表の無い書体には何もしない
 */
export function patchFontkitCffFlex(fk: unknown) {
  const font = fk as FkFont;
  let tables: Record<string, FkTable | undefined> | undefined;
  try {
    tables = font.directory?.tables;
  } catch {
    return;
  }
  // CFF2 だけの書体・TrueType の書体からは、原型を取らない (CFF の版 1 の書体を読んだときに差し替える)
  if (!tables?.['CFF '] || tables.glyf) return;
  if (typeof font._getBaseGlyph !== 'function') throw new Error('@pdf-lib/fontkit の書体の _getBaseGlyph が見つかりません (fontkit の版が変わり、fontkitCffFlex.ts の差し替えが合いません)');
  const glyph = font._getBaseGlyph(0);
  const proto = (glyph ? Object.getPrototypeOf(glyph) : null) as { _getPath?: (this: FkCffGlyph) => FkPath; [PATCHED]?: boolean } | null;
  if (proto?.[PATCHED]) return;
  if (!proto || !Object.prototype.hasOwnProperty.call(proto, '_getPath') || typeof proto._getPath !== 'function') throw new Error('@pdf-lib/fontkit の CFF の字形の _getPath が見つかりません (fontkit の版が変わり、fontkitCffFlex.ts の差し替えが合いません)');
  const orig = proto._getPath;
  proto._getPath = function () {
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
