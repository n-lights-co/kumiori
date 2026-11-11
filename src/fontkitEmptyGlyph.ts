/**
 * fontkitEmptyGlyph — @pdf-lib/fontkit の、輪郭の無い TrueType の字形 (空白など) の外枠の読み方を正す。
 *
 * fontkit の TTFGlyph._getCBox は、字形の見出し (glyf の字形の先頭の 10 バイト: numberOfContours・xMin・yMin・xMax・yMax) を、
 * 字形にデータが無いときにも読む。OpenType の 'loca' の表の決まり: 字形 n の長さは offsets[n + 1] − offsets[n] で、0 なら
 * その字形に輪郭は無く、glyf に見出しも無い。そのため:
 *  - glyf の最後に置かれた輪郭の無い字形 (Arimo の U+00A0 = 最後の字形) は、表 (ファイル) の外を読んで例外になる
 *    (「Trying to access beyond buffer length」)。外枠は、送り (advanceWidth → _getMetrics → _getCBox) を読むときにも使うので、
 *    fontkit の layout を通るその字 (測る・字形の番号を決める・輪郭で描く) が、どれも例外になる
 *  - ほかの輪郭の無い字形 (U+0020 など) は、隣の字形の見出しを読んで、でたらめな外枠を返す
 * 輪郭の無い字形のときは、glyf を読まずに、空の外枠 (0, 0, 0, 0) を返す。輪郭の無い字形の外枠は、どこにも描かれないので、
 * 送りと原点だけが意味を持つ (横の送り・左の余白は hmtx から、縦の送り・上の余白は vmtx か、無ければ OS/2・hhea の上下から
 * 決まる。外枠の上端が 0 になるので、vmtx の無い書体の空白の上の余白は「上の線から基線まで」になる)。
 * 可変フォントの分岐 (書体に変形の処理があり、内部の呼び出しでないとき: 輪郭から外枠を作り直す) は、fontkit のまま。
 */

/** 差し替え済みの印 (原型に付ける。同じ fontkit を複数回読み込んでも二重に包まない) */
const PATCHED = Symbol.for('kumiori.fontkitEmptyGlyphPatched');

interface TtfGlyph {
  id: number;
  _font: { loca?: { offsets?: ArrayLike<number> }; _variationProcessor?: unknown };
  path: { cbox: object };
}
type GetCBox = (this: TtfGlyph, internal?: boolean) => object;

/** fk (fontkit の書体) の TrueType の字形の原型の _getCBox を差し替える。glyf の表の無い書体 (CFF など) には何もしない */
export function patchFontkitEmptyGlyph(fk: unknown) {
  const f = fk as { directory?: { tables?: Record<string, unknown> }; getGlyph?: (id: number) => object | null };
  if (!f.directory?.tables?.glyf || typeof f.getGlyph !== 'function') return;
  let glyph: object | null;
  try {
    glyph = f.getGlyph(0);
  } catch {
    return;
  }
  // TTFGlyph の原型: _getCBox と _parseGlyphCoord を自分で持つもの (色つきの字形の型 (COLR・sbix) は、その子)
  let proto: (Record<string, unknown> & { [PATCHED]?: boolean }) | null = glyph ? Object.getPrototypeOf(glyph) : null;
  while (proto && !(Object.hasOwn(proto, '_getCBox') && Object.hasOwn(proto, '_parseGlyphCoord'))) proto = Object.getPrototypeOf(proto);
  if (!proto || proto[PATCHED] || typeof proto._getCBox !== 'function') return;
  const original = proto._getCBox as GetCBox;
  proto._getCBox = function (this: TtfGlyph, internal?: boolean) {
    const offsets = this._font.loca?.offsets;
    if (offsets && offsets[this.id] === offsets[this.id + 1] && !(this._font._variationProcessor && !internal)) {
      // 外枠の型 (fontkit の BBox) は、空の輪郭の外枠から取る (輪郭の無い字形の path は、glyf を読まない)
      const BBox = this.path.cbox.constructor as new (minX: number, minY: number, maxX: number, maxY: number) => object;
      return Object.freeze(new BBox(0, 0, 0, 0));
    }
    return original.call(this, internal);
  } as never;
  proto[PATCHED] = true;
}
