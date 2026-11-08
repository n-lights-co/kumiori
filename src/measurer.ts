/**
 * measurer — 文字幅計測
 *
 * 計測バックエンドは 2 つ:
 *   canvas  : Canvas 2D measureText (ブラウザ。プレビューと同じ計測器)
 *   fontkit : フォントファイルの advanceWidth を直接合算 (PDF と同じ計測器 / Node テスト用)
 * 同一フォントファイルを見るため両者の結果は一致する (字ごとに測り、カーニング (kernPairs) と合字 (字の並びの単位) は組版側で足す)。
 *
 * 計測は 1000px の基準サイズで行い、実サイズへ線形スケールする（ヒンティングの影響を受けない）。
 */
import type { FontManager, LoadedFont } from './fontManager';
import type { WritingMode } from './types';
import { isFullWidth, verticalTreatment, type VerticalTreatment } from './jis';

export interface RunStyle {
  fontFamily?: string;
  fontWeight?: number;
  /** pt */
  fontSize: number;
  /** 字幅の伸縮 (font-stretch。横書きだけ、字形を水平に拡縮する)。既定 1 */
  stretch?: number;
  /** 字形を差し替える OpenType の機能 (横書きだけ) */
  features?: string[];
  /** 縦書きの字の向き (text-orientation)。省略時は mixed */
  orientation?: 'mixed' | 'upright' | 'sideways';
}

export interface GlyphMetrics {
  ch: string;
  font: LoadedFont;
  fontSize: number;
  /** 行内進行方向 (inline-progression) の送り長さ */
  advance: number;
  /** block 方向の厚み (1 文字枠 = em) */
  cross: number;
  /** 横組み時の自然な水平幅 (描画位置補正用) */
  naturalWidth: number;
  /** advance に足した字間・語間 (letter-spacing・word-spacing)。字形の送りではない分 (無ければ 0) */
  spacing?: number;
  /** 縦書きのときの処理 (横書きは undefined) */
  vertical?: VerticalTreatment;
  /** 字形の水平の拡縮 (font-stretch) */
  scaleX?: number;
  /** 描く字 (ch の代わり)。書体が持たない特殊な空白は、普通の空白の字形で描く (送りは advance) */
  draw?: string;
}

/**
 * 書体が持たないときの特殊な空白の幅 (em。Unicode の定める幅)。U+2007 (数字幅の空白) は「0」、U+2008 (句読点幅の空白) は「.」の幅。
 * 測る仕組みによって、書体に無い字は「字形の無い字」(豆腐) の幅になるので、決まった幅にそろえる
 */
const SPECIAL_SPACE_EM: Record<string, number | string> = {
  '\u2000': 0.5,
  '\u2001': 1,
  '\u2002': 0.5,
  '\u2003': 1,
  '\u2004': 1 / 3,
  '\u2005': 0.25,
  '\u2006': 1 / 6,
  '\u2007': '0',
  '\u2008': '.',
  '\u2009': 0.2,
  '\u200A': 0.1,
  '\u202F': 0.2,
  '\u205F': 4 / 18,
};

export interface RubyMetrics {
  baseAdvance: number;
  rubyAdvance: number;
  /** RubyArea が行内進行方向に占める長さ = max(base, ruby) */
  advance: number;
  /** ルビが block 方向に張り出す厚さ (ルビ文字サイズ) */
  rubyExtent: number;
  rubySize: number;
  baseGlyphs: GlyphMetrics[];
  rubyGlyphs: GlyphMetrics[];
  /** 下側のルビ (2 段目) の字と、その張り出す厚さ */
  underGlyphs?: GlyphMetrics[];
  underExtent?: number;
}

export interface TateChuYokoMetrics {
  /** 横組みの自然な幅の合計 */
  naturalWidth: number;
  scale: number;
  /** 占有する全角枠数 (常に 1) */
  frames: number;
  /** minScale 以上の圧縮で 1 文字枠に収まるか */
  fits: boolean;
  /** 縦書き行内での送り長さ = 1em */
  advance: number;
  /** 厚み (em) */
  cross: number;
  /** 字ごとの幅と、その字を測った書体 (先頭の字の書体 font に無い字は代替の書体で測る。描くときも同じ書体を使う) */
  chars: { ch: string; width: number; font: LoadedFont }[];
  /** 先頭の字の書体 (基線の位置の基準) */
  font: LoadedFont;
}

const REF_SIZE = 1000;

/**
 * 字形の送り (フォントの単位) を hmtx から読む。fontkit は字形の外形 (glyf) を読めないと、送りも layout も例外になる
 * (Arimo の最後の字形 U+00A0 など) ので、そのときに使う
 */
function hmtxAdvance(fk: LoadedFont['fk'], text: string): number {
  const f = fk as unknown as { glyphForCodePoint(cp: number): { id: number }; hmtx?: { metrics: { length: number; get(i: number): { advance: number } | undefined } } };
  const m = f.hmtx?.metrics;
  if (!m) return 0;
  return [...text].reduce((a, c) => a + (m.get(Math.min(f.glyphForCodePoint(c.codePointAt(0)!).id, m.length - 1))?.advance ?? 0), 0);
}

export class Measurer {
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  /** 字の送り (em 比) を、書体ごとに字 (と OpenType の機能) で覚える。測り方 (backend) を変えたら消す */
  private cache = new Map<LoadedFont, Map<string, number>>();
  /** kern の結果 (書体ごと、2 字の組ごと) */
  private kernPairs = new Map<LoadedFont, Map<string, number>>();

  constructor(
    private fonts: FontManager,
    private backend: 'canvas' | 'fontkit' = typeof document !== 'undefined' ? 'canvas' : 'fontkit',
  ) {
    if (backend === 'canvas') {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      ctx.fontKerning = 'none';
      this.ctx = ctx;
    }
  }

  setBackend(b: 'canvas' | 'fontkit') {
    if (b === 'canvas' && !this.ctx) return;
    this.backend = b;
    this.cache.clear();
  }

  /** 測った幅が変わりうる状態 (測り方と書体の登録)。行分けの結果を覚えたものが古くなったかを見る */
  version(): string {
    return `${this.backend}:${this.fonts.generation}`;
  }

  font(style: Pick<RunStyle, 'fontFamily' | 'fontWeight'>): LoadedFont {
    return this.fonts.get(style.fontFamily, style.fontWeight ?? 400);
  }

  /** 横組みの水平 advance (1 文字単位) を em 比で返す */
  private emAdvance(font: LoadedFont, ch: string, features?: string[]): number {
    let byFont = this.cache.get(font);
    if (!byFont) this.cache.set(font, (byFont = new Map()));
    const k = features?.length ? ch + '\u0000' + features.join(',') : ch;
    const hit = byFont.get(k);
    if (hit !== undefined) return hit;
    let w: number;
    try {
      w = this.measureEm(font, ch, features);
    } catch {
      w = hmtxAdvance(font.fk, ch) / font.unitsPerEm;
    }
    byFont.set(k, w);
    return w;
  }

  private vertCache = new Map<LoadedFont, Map<string, boolean>>();
  /** 書体の縦書き用の字形 (OpenType の vert) が、この字を別の字形に替えるか */
  private hasVert(font: LoadedFont, ch: string): boolean {
    let m = this.vertCache.get(font);
    if (!m) this.vertCache.set(font, (m = new Map()));
    const hit = m.get(ch);
    if (hit !== undefined) return hit;
    let v = false;
    try {
      const plain = font.fk.layout(ch, { kern: false, liga: false, clig: false } as never).glyphs;
      const vert = font.fk.layout(ch, { kern: false, liga: false, clig: false, vert: true } as never).glyphs;
      v = plain.length === 1 && vert.length === 1 && plain[0].id !== vert[0].id && vert[0].id !== 0;
    } catch {
      v = false;
    }
    m.set(ch, v);
    return v;
  }

  private measureEm(font: LoadedFont, ch: string, features?: string[]): number {
    let w: number;
    if (features?.length) {
      // 機能を当てた字形の送り (Canvas では機能を指定できないので、どちらも fontkit で測る)
      // 送りは、機能で調整した後の値 (palt などの位置の機能も効く)
      const run = font.fk.layout(ch, { kern: false, liga: false, clig: false, ...Object.fromEntries(features.map((f) => [f, true])) } as never);
      w = run.positions.reduce((a, p) => a + p.xAdvance, 0) / font.unitsPerEm;
    } else if (this.backend === 'canvas' && this.ctx) {
      this.ctx.font = this.fonts.cssFont(font, REF_SIZE);
      w = this.ctx.measureText(ch).width / REF_SIZE;
    } else {
      const run = font.fk.layout(ch, { kern: false, liga: false, clig: false } as never);
      // 複数の字の単位 (つながる字の並びなど) は、書体の GPOS で調整した送りの合計 (記号の送り・字の間の調整を含む)
      w = ([...ch].length > 1 ? run.positions.reduce((a, p) => a + p.xAdvance, 0) : run.glyphs.reduce((a, g) => a + g.advanceWidth, 0)) / font.unitsPerEm;
    }
    return w;
  }

  /**
   * ペアカーニング (em 比)。a の後ろに b が続くとき、a の送りに足す量 (詰めるなら負)。
   * フォントの kern / GPOS を fontkit で引く。a・b が別のフォントで描かれるときは 0。
   * features (smcp・onum など、字形を差し替える機能) は、差し替えた後の字形の組で引く (GSUB の後に GPOS を当てる。OpenType の処理の順)
   */
  kern(a: string, b: string, style: Pick<RunStyle, 'fontFamily' | 'fontWeight'> & { features?: string[]; skipClass0?: boolean }): number {
    const w = style.fontWeight ?? 400;
    const fa = this.fonts.getForChar(style.fontFamily, w, a);
    if (fa !== this.fonts.getForChar(style.fontFamily, w, b)) return 0;
    // 書体ごとに、2 字をつないだキーで覚える
    let pairs = this.kernPairs.get(fa);
    if (!pairs) this.kernPairs.set(fa, (pairs = new Map()));
    const feats = style.features ?? [];
    const k = a + '\u0000' + b + (feats.length ? '\u0000' + feats.join(',') : '') + (style.skipClass0 ? '\u0000c0' : '');
    const hit = pairs.get(k);
    if (hit !== undefined) return hit;
    let v = 0;
    try {
      const run = fa.fk.layout(a + b, { kern: true, liga: false, clig: false, ...Object.fromEntries(feats.map((f) => [f, true])) } as never);
      if (run.glyphs.length === 2) v = (run.positions[0].xAdvance - run.glyphs[0].advanceWidth) / fa.unitsPerEm;
      // アンテナハウス互換: 組の表 (PairPos 形式 2) で、最初の字がクラス 0 の組は詰めない
      if (v && style.skipClass0 && run.glyphs.length === 2 && pairClassZero(fa.fk, run.glyphs[0].id, run.glyphs[1].id)) v = 0;
    } catch {
      v = 0;
    }
    pairs.set(k, v);
    return v;
  }

  /**
   * 1 文字のメトリクス。
   *  horizontal-tb: advance = 水平幅,           cross = em
   *  vertical-rl  : advance = 字の「高さ」(正立全角=em / 横倒し=水平幅), cross = 字の「幅」(= em 枠)
   */
  glyph(ch: string, style: RunStyle, wm: WritingMode): GlyphMetrics {
    const font = this.fonts.getForChar(style.fontFamily, style.fontWeight ?? 400, ch);
    const fs = style.fontSize;
    // 書体が持たない特殊な空白 (U+2000〜U+200A・U+202F・U+205F): 決まった幅の、普通の空白の字形
    const special = SPECIAL_SPACE_EM[ch];
    if (special !== undefined && !this.fonts.hasGlyph(font, ch)) {
      const sp = this.fonts.getForChar(style.fontFamily, style.fontWeight ?? 400, ' ');
      const w = (typeof special === 'string' ? this.emAdvance(sp, special) : special) * fs;
      return { ch, font: sp, fontSize: fs, advance: w, cross: fs, naturalWidth: w, draw: ' ' };
    }
    const natural = this.emAdvance(font, ch, wm === 'horizontal-tb' ? style.features : undefined) * fs;
    if (wm === 'horizontal-tb') {
      const k = style.stretch ?? 1;
      if (k !== 1) return { ch, font, fontSize: fs, advance: natural * k, cross: fs, naturalWidth: natural * k, scaleX: k };
      return { ch, font, fontSize: fs, advance: natural, cross: fs, naturalWidth: natural };
    }
    const t = verticalTreatment(ch, (c) => this.fonts.hasGlyph(font, c), style.orientation, (c) => this.hasVert(font, c));
    // 横倒し字は 90° 回すので進行方向の長さは元の水平幅。正立の字は 1em 送り (text-orientation: upright の欧字・書体の縦書き用の字形も)
    const advance = t.mode === 'rotate' ? natural : isFullWidth(ch) || style.orientation === 'upright' || t.features ? fs : natural;
    const nat = t.features ? this.emAdvance(font, ch, t.features) * fs : t.glyph === ch ? natural : this.emAdvance(font, t.glyph) * fs;
    return { ch, font, fontSize: fs, advance, cross: fs, naturalWidth: nat, vertical: t };
  }

  /** 文字列を 1 文字ずつ計測 */
  glyphs(text: string, style: RunStyle, wm: WritingMode, letterSpacing = 0): GlyphMetrics[] {
    const out: GlyphMetrics[] = [];
    for (const ch of text) {
      const g = this.glyph(ch, style, wm);
      if (letterSpacing) {
        g.advance += letterSpacing;
        g.spacing = letterSpacing;
      }
      out.push(g);
    }
    return out;
  }

  /**
   * ルビ: 親文字とルビ文字の長さを比較して RubyArea 全体の確保長を決める。
   *   advance  = max(baseAdvance, rubyAdvance)
   *   rubyExtent = ルビ文字サイズ (block 方向に張り出す厚さ)
   */
  ruby(baseText: string, rubyText: string, style: RunStyle, wm: WritingMode, rubyScale = 0.5, underText?: string): RubyMetrics {
    const rubySize = style.fontSize * rubyScale;
    const rubyStyle: RunStyle = { ...style, fontSize: rubySize };
    const baseGlyphs = this.glyphs(baseText, style, wm);
    const rubyGlyphs = this.glyphs(rubyText, rubyStyle, wm);
    const baseAdvance = baseGlyphs.reduce((a, g) => a + g.advance, 0);
    const rubyAdvance = rubyGlyphs.reduce((a, g) => a + g.advance, 0);
    const underGlyphs = underText ? this.glyphs(underText, rubyStyle, wm) : undefined;
    const underAdvance = underGlyphs ? underGlyphs.reduce((a, g) => a + g.advance, 0) : 0;
    return {
      baseAdvance,
      rubyAdvance,
      advance: Math.max(baseAdvance, rubyAdvance, underAdvance),
      rubyExtent: rubyText ? rubySize : 0,
      rubySize,
      baseGlyphs,
      rubyGlyphs,
      ...(underGlyphs ? { underGlyphs, underExtent: rubySize } : {}),
    };
  }

  /**
   * 縦中横: 文字列を横組みで計測し、全角 1 文字枠 (em × em) に収まるか判定する。
   *   横幅 W が em を超えるなら水平方向に scale = em / W へ圧縮。
   *   scale が minScale 未満になる (読みづらいほど潰れる) 場合は fits = false とし、
   *   呼び出し側で横倒し組み (通常の縦書きの欧文扱い) にフォールバックさせる。
   * 縦書き行内での送り長さは常に 1em (= 1 文字分)。
   */
  tateChuYoko(text: string, style: RunStyle, minScale = 0.5): TateChuYokoMetrics {
    const fs = style.fontSize;
    const font = this.fonts.getForChar(style.fontFamily, style.fontWeight ?? 400, [...text][0] ?? '0');
    const chars = [...text].map((ch) => {
      const f = this.fonts.getForChar(style.fontFamily, style.fontWeight ?? 400, ch);
      return { ch, width: this.emAdvance(f, ch) * fs, font: f };
    });
    const naturalWidth = chars.reduce((a, c) => a + c.width, 0);
    const scale = naturalWidth <= fs ? 1 : fs / naturalWidth;
    return { naturalWidth, scale, frames: 1, fits: scale >= minScale - 1e-9, advance: fs, cross: fs, chars, font };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Coverage 表の中の字か (OpenType の共通の表 Coverage: 形式 1 は字の一覧、形式 2 は字の範囲) */
function inCoverage(cov: any, gid: number): boolean {
  if (!cov) return false;
  if (cov.version === 1) return (cov.glyphs as number[]).includes(gid);
  return (cov.rangeRecords as Array<{ start: number; end: number }>).some((r) => gid >= r.start && gid <= r.end);
}
/** ClassDef 表の字のクラス (どのクラスにも割り当てていない字はクラス 0。OpenType chapter2 の Class Definition Table) */
function classOf(cd: any, gid: number): number {
  if (!cd) return 0;
  if (cd.version === 1) {
    const k = gid - cd.startGlyph;
    return k >= 0 && k < cd.classValueArray.length ? cd.classValueArray[k] : 0;
  }
  const r = (cd.classRangeRecord as Array<{ start: number; end: number; class: number }>).find((x) => gid >= x.start && gid <= x.end);
  return r ? r.class : 0;
}
/**
 * kern の機能の組の表で、字 a・b の組に当たる最初の副表が形式 2 (クラスの組) で、a がクラス 0 か。
 * 形式 1 の副表は、a を含んでも b との組が無ければ次の副表へ進む (GPOS の PairPos の当て方)
 */
export function pairClassZero(fk: any, a: number, b: number): boolean {
  try {
    const gpos = fk?.GPOS;
    if (!gpos) return false;
    const idx = new Set<number>();
    for (const r of gpos.featureList ?? []) if (r.tag === 'kern') for (const i of r.feature.lookupListIndexes) idx.add(i);
    for (const i of [...idx].sort((x, y) => x - y)) {
      const lk = gpos.lookupList.get(i);
      if (!lk || (lk.lookupType !== 2 && lk.lookupType !== 9)) continue;
      for (const st0 of lk.subTables ?? []) {
        const st = lk.lookupType === 9 ? st0.extension : st0;
        if (!st || (lk.lookupType === 9 && st0.lookupType !== 2) || !inCoverage(st.coverage, a)) continue;
        if (st.version === 1) {
          const set = st.pairSets?.get?.(st.coverage.version === 1 ? st.coverage.glyphs.indexOf(a) : coverageIndex(st.coverage, a)) ?? [];
          if ([...set].some((p: { secondGlyph: number }) => p.secondGlyph === b)) return false;
          continue;
        }
        return classOf(st.classDef1, a) === 0;
      }
    }
  } catch {
    return false;
  }
  return false;
}
function coverageIndex(cov: any, gid: number): number {
  for (const r of cov.rangeRecords as Array<{ start: number; end: number; startCoverageIndex: number }>) if (gid >= r.start && gid <= r.end) return r.startCoverageIndex + gid - r.start;
  return -1;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
