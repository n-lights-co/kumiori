/**
 * 数式用の書体 (OpenType の MATH 表を持つ書体) を読む。
 *
 * MATH 表の構造 (MathConstants・MathGlyphInfo・MathVariants と、その下の表の項目の並び) は、
 * fontTools 4.68 の表の定義 (fontTools.ttLib.tables.otData の MATH・MathConstants・MathGlyphInfo・
 * MathItalicsCorrectionInfo・MathTopAccentAttachment・MathKernInfo・MathKern・MathVariants・
 * MathGlyphConstruction・GlyphAssembly・GlyphPartRecord・MathValueRecord) と突き合わせて書いた。
 * Coverage 表は OpenType の共通の形式 (形式 1: 字形の番号の並び、形式 2: 範囲の並び)。
 */

/** fontkit の字形 (使うところだけ) */
export interface FkGlyph {
  id: number;
  advanceWidth: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  path: { commands: Array<{ command: string; args: number[] }> };
}

/** fontkit の書体 (使うところだけ) */
export interface FkFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  directory: { tables: Record<string, { offset: number; length: number } | undefined> };
  stream: { buffer: Uint8Array };
  glyphForCodePoint(cp: number): FkGlyph;
  getGlyph(id: number): FkGlyph;
  hasGlyphForCodePoint(cp: number): boolean;
  layout(text: string, features?: unknown): { glyphs: FkGlyph[]; positions: Array<{ xAdvance: number; xOffset: number; yOffset: number }> };
}

/** MathConstants の名前 (表の並びの順。最初の 4 つと最後の 1 つは MathValueRecord ではない) */
const CONSTANT_NAMES = [
  'mathLeading',
  'axisHeight',
  'accentBaseHeight',
  'flattenedAccentBaseHeight',
  'subscriptShiftDown',
  'subscriptTopMax',
  'subscriptBaselineDropMin',
  'superscriptShiftUp',
  'superscriptShiftUpCramped',
  'superscriptBottomMin',
  'superscriptBaselineDropMax',
  'subSuperscriptGapMin',
  'superscriptBottomMaxWithSubscript',
  'spaceAfterScript',
  'upperLimitGapMin',
  'upperLimitBaselineRiseMin',
  'lowerLimitGapMin',
  'lowerLimitBaselineDropMin',
  'stackTopShiftUp',
  'stackTopDisplayStyleShiftUp',
  'stackBottomShiftDown',
  'stackBottomDisplayStyleShiftDown',
  'stackGapMin',
  'stackDisplayStyleGapMin',
  'stretchStackTopShiftUp',
  'stretchStackBottomShiftDown',
  'stretchStackGapAboveMin',
  'stretchStackGapBelowMin',
  'fractionNumeratorShiftUp',
  'fractionNumeratorDisplayStyleShiftUp',
  'fractionDenominatorShiftDown',
  'fractionDenominatorDisplayStyleShiftDown',
  'fractionNumeratorGapMin',
  'fractionNumDisplayStyleGapMin',
  'fractionRuleThickness',
  'fractionDenominatorGapMin',
  'fractionDenomDisplayStyleGapMin',
  'skewedFractionHorizontalGap',
  'skewedFractionVerticalGap',
  'overbarVerticalGap',
  'overbarRuleThickness',
  'overbarExtraAscender',
  'underbarVerticalGap',
  'underbarRuleThickness',
  'underbarExtraDescender',
  'radicalVerticalGap',
  'radicalDisplayStyleVerticalGap',
  'radicalRuleThickness',
  'radicalExtraAscender',
  'radicalKernBeforeDegree',
  'radicalKernAfterDegree',
] as const;

export type MathConstantName = (typeof CONSTANT_NAMES)[number] | 'scriptPercentScaleDown' | 'scriptScriptPercentScaleDown' | 'delimitedSubFormulaMinHeight' | 'displayOperatorMinHeight' | 'radicalDegreeBottomRaisePercent';

/** 伸ばす字の部品 (GlyphPartRecord) */
export interface GlyphPart {
  glyph: number;
  start: number;
  end: number;
  full: number;
  extender: boolean;
}

/** 字の伸ばし方 (MathGlyphConstruction) */
export interface Construction {
  variants: Array<{ glyph: number; advance: number }>;
  assembly?: { italic: number; parts: GlyphPart[] };
}

export interface MathFont {
  fk: FkFont;
  upm: number;
  constants: Record<MathConstantName, number>;
  minConnectorOverlap: number;
  italic(glyph: number): number;
  topAccent(glyph: number): number | undefined;
  /** 縦 (vertical: true) か横に伸ばす字の作り方 */
  construction(glyph: number, vertical: boolean): Construction | undefined;
}

/** fontkit の書体から MATH 表を読む。MATH 表が無ければ undefined */
export function readMathFont(fk: FkFont): MathFont | undefined {
  const ent = fk.directory.tables.MATH;
  if (!ent) return undefined;
  const buf = fk.stream.buffer;
  const base = ent.offset;
  const u16 = (o: number) => (buf[o] << 8) | buf[o + 1];
  const i16 = (o: number) => {
    const v = u16(o);
    return v & 0x8000 ? v - 0x10000 : v;
  };
  /** Coverage 表: 字形の番号 → 並びの番号 */
  const coverage = (o: number): Map<number, number> => {
    const m = new Map<number, number>();
    const fmt = u16(o);
    if (fmt === 1) {
      const n = u16(o + 2);
      for (let k = 0; k < n; k++) m.set(u16(o + 4 + k * 2), k);
    } else if (fmt === 2) {
      const n = u16(o + 2);
      // 範囲 (RangeRecord) は字形の番号の順で重ならない (OpenType の「Coverage table」format 2) ので、広げる字形は合わせて 65536 まで。
      // 重なる範囲を並べた表 (65535 の範囲 × 65536 字形) で、上限なしに回らないよう、その数で止める
      let left = 0x10000;
      for (let k = 0; k < n && left > 0; k++) {
        const r = o + 4 + k * 6;
        const s = u16(r);
        const e = Math.min(u16(r + 2), s + left - 1);
        const idx = u16(r + 4);
        left -= Math.max(0, e - s + 1);
        for (let g = s; g <= e; g++) m.set(g, idx + g - s);
      }
    }
    return m;
  };

  // 表の頭: 版 (4 バイト)・MathConstants・MathGlyphInfo・MathVariants の位置
  const cOff = base + u16(base + 4);
  const giOff = u16(base + 6) ? base + u16(base + 6) : 0;
  const vOff = u16(base + 8) ? base + u16(base + 8) : 0;

  const constants = {} as Record<MathConstantName, number>;
  constants.scriptPercentScaleDown = i16(cOff);
  constants.scriptScriptPercentScaleDown = i16(cOff + 2);
  constants.delimitedSubFormulaMinHeight = u16(cOff + 4);
  constants.displayOperatorMinHeight = u16(cOff + 6);
  CONSTANT_NAMES.forEach((name, k) => {
    // MathValueRecord: 値 (int16) と Device 表の位置 (使わない)
    constants[name] = i16(cOff + 8 + k * 4);
  });
  constants.radicalDegreeBottomRaisePercent = u16(cOff + 8 + CONSTANT_NAMES.length * 4);

  // 字ごとの値の表 (Coverage と MathValueRecord の並び)
  const valueTable = (o: number) => {
    if (!o) return new Map<number, number>();
    const cov = coverage(o + u16(o));
    const out = new Map<number, number>();
    for (const [g, k] of cov) out.set(g, i16(o + 4 + k * 4));
    return out;
  };
  let italics = new Map<number, number>();
  let accents = new Map<number, number>();
  if (giOff) {
    const io = u16(giOff);
    const ao = u16(giOff + 2);
    italics = valueTable(io ? giOff + io : 0);
    accents = valueTable(ao ? giOff + ao : 0);
  }

  let minConnectorOverlap = 0;
  const vert = new Map<number, number>();
  const horiz = new Map<number, number>();
  if (vOff) {
    minConnectorOverlap = u16(vOff);
    const vc = u16(vOff + 2);
    const hc = u16(vOff + 4);
    const vn = u16(vOff + 6);
    const hn = u16(vOff + 8);
    // 縦の字の MathGlyphConstruction の位置の並び、続いて横の字の並び
    if (vc) for (const [g, k] of coverage(vOff + vc)) if (k < vn) vert.set(g, vOff + u16(vOff + 10 + k * 2));
    if (hc) for (const [g, k] of coverage(vOff + hc)) if (k < hn) horiz.set(g, vOff + u16(vOff + 10 + (vn + k) * 2));
  }
  const cache = new Map<string, Construction | undefined>();
  const construction = (glyph: number, vertical: boolean): Construction | undefined => {
    const key = `${vertical ? 'v' : 'h'}${glyph}`;
    if (cache.has(key)) return cache.get(key);
    const o = (vertical ? vert : horiz).get(glyph);
    let c: Construction | undefined;
    if (o !== undefined) {
      const ao = u16(o);
      const n = u16(o + 2);
      const variants = Array.from({ length: n }, (_, k) => ({ glyph: u16(o + 4 + k * 4), advance: u16(o + 6 + k * 4) }));
      c = { variants };
      if (ao) {
        const a = o + ao;
        const pn = u16(a + 4);
        const parts = Array.from({ length: pn }, (_, k) => {
          const p = a + 6 + k * 10;
          return { glyph: u16(p), start: u16(p + 2), end: u16(p + 4), full: u16(p + 6), extender: (u16(p + 8) & 1) === 1 };
        });
        c.assembly = { italic: i16(a), parts };
      }
    }
    cache.set(key, c);
    return c;
  };

  return {
    fk,
    upm: fk.unitsPerEm,
    constants,
    minConnectorOverlap,
    italic: (g) => italics.get(g) ?? 0,
    topAccent: (g) => accents.get(g),
    construction,
  };
}
