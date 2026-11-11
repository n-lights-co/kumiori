/**
 * fontManager — TTF/OTF を 1 回だけ fetch し、
 *   ・Canvas 用: FontFace として document.fonts に登録
 *   ・PDF 用  : 生の ArrayBuffer (pdf-lib + fontkit で埋め込み)
 *   ・組版用  : fontkit でパースしたメトリクス (em 内ベースライン位置・字形の有無)
 * を同一バイト列から作る。Canvas と PDF が「同じフォントファイル」を見るため、
 * 文字幅の食い違いが原理的に発生しない。
 */
import { collectionFaces, isCollection } from './fontLoader';
import { toSfnt } from './webFont';
import { msg } from './messages';
import { patchFontkitShaping } from './fontkitShaping';
import { patchFontkitCffFlex } from './fontkitCffFlex';
import { colorFontOf, orderByPresentation, prepareColorFont, presentationOf } from './colorGlyph';
import { instantiateFont, readVariationInfo, staticCff2ToCff, variationNamePrefix, type VariationInfo } from './fontInstancer';
import { splitVariation, variationNumber as num, variationSuffix, type VariationRequest } from './fontVariation';
import fontkit from '@pdf-lib/fontkit';
import type { FontSpec } from './types';

/** 差し替え済みの印 (fontkit の原型に付ける。pdfLibPatches.ts と同じ決まり) */
const UVS_PATCHED = Symbol.for('kumiori.fontkitUvsPatched');

type UvsSelector = {
  varSelector: number;
  defaultUVS?: ArrayLike<{ startUnicodeValue: number; additionalCount: number }> | null;
  nonDefaultUVS?: ArrayLike<{ unicodeValue: number; glyphID: number }> | null;
};

/** 並んだ表の 2 分探索 (cmp が 0 を返す項目。無ければ undefined) */
function searchSorted<T>(arr: ArrayLike<T>, cmp: (x: T) => number): T | undefined {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = cmp(arr[mid]);
    if (r < 0) hi = mid - 1;
    else if (r > 0) lo = mid + 1;
    else return arr[mid];
  }
  return undefined;
}

/**
 * @pdf-lib/fontkit の、異体字の並び (基底の字 + 異体字セレクタ) の字形の引き方を正す。
 *
 * fontkit の CmapProcessor.getVariationSelector は、既定の表 (Default UVS) に基底の字が「ある」ときだけ
 * 非既定の表 (Non-Default UVS) を引くので、非既定の並びのほとんどが引けず、基底の字の字形になる
 * (Noto Serif JP の 兎 U+514E + U+E0100 は、非既定の表に字形があるのに、既定の字形が返る)。
 *
 * OpenType の 'cmap' の format 14 (Unicode Variation Sequences) のとおりに引く:
 *  - 異体字セレクタの記録 (VariationSelector。varSelector の昇順) を探す
 *  - 既定の表 (DefaultUVS。UnicodeRange の昇順) に基底の字があれば「既定の並び」で、字形は Unicode の cmap の基底の字のもの
 *  - 無ければ、非既定の表 (NonDefaultUVS。UVSMapping の unicodeValue の昇順) の glyphID
 *  - どちらにも無い並びは、書体が持たない (基底の字の字形になる。0 を返すと、呼び出し元の lookup が Unicode の cmap を引く)
 *
 * 測るとき (measurer.ts)・字形の番号を決めるとき (areaResources.ts)・描くとき (canvasRenderer.ts の輪郭・pdf-lib の埋め込み) は、
 * どれも fontkit の layout → glyphsForString → CmapProcessor.lookup を通るので、原型 (prototype) を 1 回差し替えれば、同じ字形になる
 */
export function patchFontkitVariationSelector(fk: unknown) {
  let proto: { getVariationSelector?: (this: { uvs?: { varSelectors: { toArray(): UvsSelector[] } } | null }, cp: number, vs: number) => number; [UVS_PATCHED]?: boolean } | null;
  try {
    // cmap を読めない書体は、_cmapProcessor を取るときに例外になる (その書体は、あとで字を引くときに扱う)
    proto = Object.getPrototypeOf((fk as { _cmapProcessor?: object })._cmapProcessor ?? null);
  } catch {
    return;
  }
  if (!proto || proto[UVS_PATCHED] || typeof proto.getVariationSelector !== 'function') return;
  /** 書体の format 14 の表ごとの、異体字セレクタの記録 (読むのは 1 回) */
  const selectors = new WeakMap<object, UvsSelector[]>();
  proto.getVariationSelector = function (codepoint: number, variationSelector: number) {
    const uvs = this.uvs;
    if (!uvs) return 0;
    let list = selectors.get(uvs);
    if (!list) selectors.set(uvs, (list = uvs.varSelectors.toArray()));
    const sel = searchSorted(list, (x) => variationSelector - x.varSelector);
    if (!sel) return 0;
    if (sel.defaultUVS && searchSorted(sel.defaultUVS, (x) => (codepoint < x.startUnicodeValue ? -1 : codepoint > x.startUnicodeValue + x.additionalCount ? 1 : 0))) return 0;
    return (sel.nonDefaultUVS && searchSorted(sel.nonDefaultUVS, (x) => codepoint - x.unicodeValue)?.glyphID) || 0;
  };
  proto[UVS_PATCHED] = true;
}

export interface LoadedFont {
  key: string;
  family: string;
  weight: number;
  /** PDF 埋め込み用 */
  buffer: ArrayBuffer;
  /** Canvas 用 (ブラウザ環境のみ) */
  face?: FontFace;
  /** fontkit パース結果 (字形有無・メトリクス) */
  fk: ReturnType<typeof fontkit.create>;
  unitsPerEm: number;
  /** em ボックス上端からベースラインまでの距離 / em (既定 0.88) */
  baselineRatio: number;
  /** 書体の上下の高さの差 (hhea の ascent − descent の大きさ) / em。字ごとの行の高さの割り振り (fontLineMetrics) に使う */
  ascentMinusDescent: number;
  /** 書体の上の高さ・下の深さ (hhea の ascent・descent の大きさ) / em。XSL の text-altitude・text-depth (use-font-metrics) */
  ascent?: number;
  descent?: number;
  /** name 表の PostScript 名 (nameID 6)・完全な名前 (nameID 4)。uniqueName で探す */
  postscriptName?: string;
  fullName?: string;
  /**
   * 可変フォント (OpenType Font Variations) の元の書体のとき: 軸・@font-face の記述子・作った実体。
   * この書体そのもの (buffer・fk) は既定の形 (default instance)。軸の値の違う形は、実体 (instanceOf を持つ LoadedFont) を作って使う
   */
  variable?: {
    info: VariationInfo;
    face: FaceDescriptors;
    /** 作った実体 (太さと軸の値ごとに 1 つ) */
    instances: Map<string, LoadedFont>;
    /** 実体を作れなかった (CFF2 の字形を読めないなど)。知らせを 1 度出して、以後は既定の形 (この書体そのもの) を返す */
    failed?: boolean;
  };
  /** 可変フォントの実体のとき: 元の書体と、軸の値 (札 → 値)。slanted は、傾きを軸 (slnt・ital) で付けた (描くときに傾けない) */
  instanceOf?: { master: LoadedFont; coords: Record<string, number>; slanted?: boolean };
  /** Canvas の ctx.font に書くファミリー名 (実体をブラウザに登録したとき。無ければ family) */
  cssFamily?: string;
}

/**
 * 書体の登録のときに渡す、@font-face の記述子 (CSS Fonts 4 §4.4・§4.7・§4.6 の、可変フォントに関わるもの)。
 * 省いた書体 (fonts の選択肢・--font で読み込んだ書体) は、入っている書体として、軸の範囲の全体を使う
 */
export interface FaceDescriptors {
  /** font-weight の範囲。'auto' (記述子が無い) は、選ぶときは登録の太さ (400)、軸の値は制限しない (§4.4) */
  weight?: [number, number] | 'auto';
  /** font-width (font-stretch) の範囲 (百分率)。'auto' は制限しない */
  width?: [number, number] | 'auto';
  /** font-style: oblique <角度>{1,2} の範囲 (度。時計回りが正)。slnt の軸の値を、この範囲に収める。省くと制限しない */
  oblique?: [number, number];
  /** font-variation-settings の記述子 (札 → 値) */
  settings?: Record<string, number>;
  /** font-named-instance の記述子 (名前つきの実体の名前) */
  namedInstance?: string;
}

const keyOf = (family: string, weight: number) => `${family}@${weight}`;

/** OS/2 の typo の上下 (sTypoAscender − sTypoDescender) が、ちょうど 1em を成す書体か (Noto CJK などの和文の書体: 字の枠 = em の箱) */
function typoSpansEm(fk: LoadedFont['fk']): { typoAscender: number; typoDescender: number } | undefined {
  const upm = fk.unitsPerEm || 1000;
  const os2 = (fk as unknown as { 'OS/2'?: { typoAscender: number; typoDescender: number } })['OS/2'];
  return os2 && Math.abs(os2.typoAscender - os2.typoDescender - upm) < upm * 0.02 ? os2 : undefined;
}

/**
 * 行内の箱の内容の領域 (CSS 2.1 §10.6.1・CSS Inline 3 §6.4) に使う、書体の上の高さ・下の深さ (em に対する比)。
 * CSS Inline 3 §3.2.1 は、書体の ascent・descent の出どころを決めていない (注記は OS/2 の sTypoAscender・sTypoDescender を勧める)。
 *  - OS/2 の typo の上下が 1em を成す書体 (和文の書体): その値 (字の枠 = em の箱。行の中の基線の位置 baselineRatio と同じ決め方)
 *  - ほかの書体: hhea の ascent・descent (USE_TYPO_METRICS の書体では OS/2 の typo の値と同じ。Chromium が使う値)。
 *    typo の値が字の上下より小さい書体 (Tinos は 0.693・0.216 で、和文の字の枠より低い) があるので、typo の値は使わない
 */
export function inlineAreaMetrics(font: Pick<LoadedFont, 'fk' | 'baselineRatio' | 'ascent' | 'descent'>): { ascent: number; descent: number } {
  if (typoSpansEm(font.fk)) return { ascent: font.baselineRatio, descent: 1 - font.baselineRatio };
  return { ascent: font.ascent ?? font.baselineRatio, descent: font.descent ?? 1 - font.baselineRatio };
}

/** fontkit で読んだ書体から、組版で使う寸法 (registerBuffer と、可変フォントの実体で同じ計算) */
function fontMetricsOf(fk: LoadedFont['fk']): Pick<LoadedFont, 'unitsPerEm' | 'baselineRatio' | 'ascentMinusDescent' | 'ascent' | 'descent'> {
  const upm = fk.unitsPerEm || 1000;
  // OS/2 typo メトリクスが ちょうど 1em を成すフォント (Noto CJK 等) は ideographic em ボックスと一致する
  const os2 = (fk as unknown as { 'OS/2'?: { typoAscender: number; typoDescender: number } })['OS/2'];
  let baselineRatio = 0.88;
  if (typoSpansEm(fk)) {
    baselineRatio = os2!.typoAscender / upm;
  } else if (typeof os2?.typoAscender !== 'number' && typeof fk.ascent === 'number' && typeof fk.descent === 'number' && fk.ascent > 0) {
    // OS/2 の表 (typo の値) の無い書体 (古い TrueType): hhea の上下 (A・D) で、CSS 2.1 §10.8.1 と同じ基準線の位置にする。
    // 行の上端から基準線までは 半行間 + A = LH/2 + (A − D)/2 なので、em の箱では比 0.5 + (A − D)/2 (em) に当たる
    baselineRatio = 0.5 + (fk.ascent + fk.descent) / (2 * upm);
  }
  const asc = Math.abs(fk.ascent ?? upm * 0.88) / upm;
  const desc = Math.abs(fk.descent ?? upm * 0.12) / upm;
  return { unitsPerEm: upm, baselineRatio, ascentMinusDescent: asc - desc, ascent: asc, descent: desc };
}

/** 実体を作れない可変フォントを知らせたか (書体のファイルごとに 1 度) */
const unsupportedWarned = new WeakSet<ArrayBuffer>();

export class FontManager {
  private fonts = new Map<string, LoadedFont>();
  private fallbackFamily: string | null = null;
  /** 日本語フォント → 欧文用フォント (欧文の字幅・字形を Times / Arial 系にするための、文字ごとの切り替え) */
  private latinFor = new Map<string, string>();

  /**
   * この書体の組の写し。読み込んだ書体 (字形の解析を済ませたもの) と、欧文の書体・別名・範囲の指定を引き継ぐ。
   * 写しに足した書体や指定は、元に影響しない (同じ書体で、文書ごとに書体を足して組むときに使う)
   */
  fork(): FontManager {
    const f = new FontManager();
    f.fonts = new Map(this.fonts);
    f.fallbackFamily = this.fallbackFamily;
    f.latinFor = new Map(this.latinFor);
    f.stacks = new Map(this.stacks);
    f.ranged = new Map(this.ranged);
    f.canvasInstances = this.canvasInstances;
    return f;
  }

  /** 別の組で読み込んだ書体を、この組にも入れる (解析し直さない) */
  adopt(lf: LoadedFont) {
    this.charFallback.clear();
    this.forCharMemo.clear();
    this.clusterMemo.clear();
    this.getMemo.clear();
    this.generation++;
    this.fonts.set(lf.key, lf);
    if (!this.fallbackFamily) this.fallbackFamily = lf.family;
  }

  /**
   * 既に読み込み済みの ArrayBuffer を登録 (Node テストやローカルファイル用)。
   * 可変フォント (fvar を持つ書体) は、既定の形をこの書体として登録し、ほかの軸の値は、引くときに実体を作る (find・instance)。
   * 輪郭が CFF2 の可変フォントは、既定の形も、引くときに実体 (静的な CFF にしたもの) を作る (CFF2 のままでは PDF に埋め込めない)。
   * face: @font-face の記述子 (省くと、入っている書体として軸の範囲の全体を使う)
   */
  async registerBuffer(family: string, weight: number, buffer: ArrayBuffer, canvas = true, face?: FaceDescriptors): Promise<LoadedFont> {
    // WOFF・WOFF2 は、ふつうの書体のファイル (TTF・OTF) に戻してから登録する (PDF にはそのまま埋め込めない。webFont.ts)。
    // 書体の集まり (TTC と、WOFF2 の書体の集まりを戻したもの) は、最初の書体を使う (@font-face で集まりを指したとき)
    buffer = toSfnt(buffer);
    if (isCollection(buffer)) buffer = collectionFaces(buffer)[0];
    // 可変でない CFF2 の書体 (fvar の無い、輪郭が CFF2 の OpenType) は、静的な CFF に作り直して登録する (CFF2 の輪郭は PDF に埋め込めない)
    try {
      buffer = staticCff2ToCff(buffer) ?? buffer;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      this.onNotice(
        msg(
          `${family}: CFF2 の輪郭の書体を、PDF に埋め込める形 (CFF) にできません (${why})。PDF では字が正しく出ないことがあります`,
          `${family}: cannot convert the font with CFF2 outlines to an embeddable form (CFF) (${why}). Glyphs may not render correctly in the PDF`,
        ),
      );
    }
    this.charFallback.clear();
    this.forCharMemo.clear();
    this.clusterMemo.clear();
    this.getMemo.clear();
    this.generation++;
    const fk = fontkit.create(new Uint8Array(buffer));
    patchFontkitVariationSelector(fk);
    patchFontkitShaping(fk);
    // CFF の字形の読みを正す: hflex・hflex1 と、CID 方式の書体の FDSelect の範囲 (輪郭で描くとき・字形の外接枠を使うとき。CFF・CFF2 の表の無い書体には何もしない)
    patchFontkitCffFlex(fk);
    // 輪郭の表を持たない、ビットマップだけの色つきの書体 (CBDT の絵文字) を組めるようにする (ほかの書体には何もしない)
    prepareColorFont(fk);
    const info = readVariationInfo(buffer);
    if (info?.unsupported && !unsupportedWarned.has(buffer)) {
      // 輪郭の差分 (TrueType の gvar か、CFF2) を持たない可変フォントの実体は作れない: 既定の形のまま 1 つの太さの書体として使う
      unsupportedWarned.add(buffer);
      this.onNotice(
        msg(
          `${family}: 輪郭の差分 (gvar の表か CFF2 の輪郭) を持たない可変フォントには対応していません。既定の形 (default instance) で組み、太さ・幅などの軸は効きません`,
          `${family}: variable fonts without outline variations (a gvar table or CFF2 outlines) are not supported; the default instance is used and the weight, width and other axes have no effect`,
        ),
      );
    }
    let fontFace: FontFace | undefined;
    if (canvas && typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
      fontFace = new FontFace(family, buffer.slice(0), { weight: String(weight) });
      await fontFace.load();
      document.fonts.add(fontFace);
    }
    const names = fk as unknown as { postscriptName?: string; fullName?: string };
    const lf: LoadedFont = {
      key: keyOf(family, weight),
      family,
      weight,
      buffer,
      face: fontFace,
      fk,
      ...fontMetricsOf(fk),
      ...(names.postscriptName ? { postscriptName: names.postscriptName } : {}),
      ...(names.fullName ? { fullName: names.fullName } : {}),
      ...(info && !info.unsupported ? { variable: { info, face: face ?? {}, instances: new Map<string, LoadedFont>() } } : {}),
    };
    if (lf.variable) this.canvasInstances = this.canvasInstances || canvas;
    this.fonts.set(lf.key, lf);
    this.getMemo.clear(); // face.load() の await の間に get が呼ばれていることがある
    if (!this.fallbackFamily) this.fallbackFamily = family;
    return lf;
  }
  /** 可変フォントの実体も、ブラウザ (document.fonts) に登録するか (可変フォントを canvas: true で登録したとき) */
  private canvasInstances = false;
  /** 書体について利用者に知らせること (対応していない可変フォントなど) の出し先。既定は console.warn (API は、結果の warnings に入れる) */
  onNotice: (message: string) => void = (m) => console.warn(m);

  /** URL (複数ならフォールバック順) から fetch して登録 */
  async load(spec: FontSpec, onProgress?: (msg: string) => void): Promise<LoadedFont> {
    const weight = spec.weight ?? 400;
    let lastErr: unknown;
    for (const url of spec.urls) {
      try {
        onProgress?.(`フォント取得: ${spec.family} ${weight} ← ${url}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (!looksLikeFont(buf)) throw new Error(msg('フォントファイルではありません', 'not a font file'));
        return await this.registerBuffer(spec.family, weight, buf);
      } catch (e) {
        lastErr = e;
        onProgress?.(`  失敗 (${String(e)}) → 次の候補へ`);
      }
    }
    throw new Error(msg(`フォント ${spec.family}@${weight} を取得できませんでした: ${String(lastErr)}`, `could not fetch the font ${spec.family}@${weight}: ${String(lastErr)}`));
  }

  async loadAll(specs: FontSpec[], onProgress?: (msg: string) => void): Promise<void> {
    await Promise.all(specs.map((s) => this.load(s, onProgress)));
  }

  /**
   * PostScript 名か完全な名前 (書体を 1 つずつ指す名前) が name の、読み込んだ書体 (ASCII の大文字小文字は区別しない)。
   * CSS Fonts 4 では、この名前で探すのは @font-face の src: local() だけ (font-family はファミリー名で探す)。
   * アンテナハウス互換の選択肢 (font-family に書いた PostScript 名で書体を選ぶ) で使う
   */
  uniqueName(name: string): LoadedFont | undefined {
    const n = name.toLowerCase();
    return [...this.fonts.values()].find((f) => f.postscriptName?.toLowerCase() === n || f.fullName?.toLowerCase() === n);
  }

  /** 読み込んだ書体と、その後に、これまでに作った可変フォントの実体 (作った順) */
  all(): LoadedFont[] {
    const out = [...this.fonts.values()];
    for (const i of this.handed.values()) if (i.instanceOf && this.fonts.get(i.instanceOf.master.key) === i.instanceOf.master) out.push(i);
    return out;
  }
  /**
   * この組が返した可変フォントの実体 (元の書体の key + 太さ・軸の値 → 実体)。all() が返す (PDF に埋める書体)。
   * 実体そのものは、元の書体の側 (LoadedFont.variable.instances) にも覚えて、書体の組の写し (fork) の間で使い回す。そちらは数に上限があり、
   * 古いものから忘れるが、この組が返した実体は、ここで持ち続ける (1 つの文書の中で、同じ指定は同じ実体)
   */
  private handed = new Map<string, LoadedFont>();

  /** 読み込んだ可変フォントの軸の札 (すべての書体の分)。可変フォントが無ければ undefined */
  variationAxes(): ReadonlySet<string> | undefined {
    if (this.axesMemo?.[0] !== this.generation) {
      const tags = new Set<string>();
      for (const f of this.fonts.values()) for (const a of f.variable?.info.axes ?? []) tags.add(a.tag);
      this.axesMemo = [this.generation, tags.size ? tags : undefined];
    }
    return this.axesMemo[1];
  }
  private axesMemo?: [number, ReadonlySet<string> | undefined];

  /**
   * 可変フォント master の、太さ weight・軸の値の指定 req の形。CSS Fonts 4 §7.2 (Feature and variation precedence) の順に軸の値を決める:
   *  1. font-weight・font-width・font-style から wght・wdth・slnt (ital)。@font-face の記述子の範囲に収める ('auto' は収めない。§4.4)
   *  2. font-named-instance の記述子の、名前つきの実体の値 (§4.7)
   *  3. font-variation-settings の記述子
   *  4. font-optical-sizing: auto の opsz (§8.1。字の大きさ。単位は呼び出し側が決める: lnode.ts の applyVariation)
   *  5. font-variation-settings の性質 (§8.2)
   * 最後に、書体の軸の範囲に収める (§7.2・§8.2)。既定の形で、太さも登録の太さなら、master そのもの。
   * ほかは、実体 (静的な書体にしたもの。fontInstancer.ts) を (太さ・軸の値) ごとに 1 度だけ作って覚える。
   * 輪郭が CFF2 の書体は、既定の形も実体にする (CFF2 の輪郭は PDF に埋め込めないので、静的な CFF にしたものを測って描く)。
   * 実体を作れない書体 (CFF2 の字形が読めないなど) は、知らせを 1 度出して、master そのものを返す
   */
  private instance(master: LoadedFont, weight: number, req: VariationRequest | undefined): LoadedFont {
    const v = master.variable!;
    if (v.failed) return master;
    const axes = v.info.axes;
    const face = v.face;
    const at = (tag: string) => axes.findIndex((a) => a.tag === tag);
    const clampTo = (x: number, r: [number, number] | 'auto' | undefined) => (Array.isArray(r) ? Math.min(r[1], Math.max(r[0], x)) : x);
    const clampAxis = (i: number, x: number) => Math.min(axes[i].max, Math.max(axes[i].min, x));
    const wg = at('wght');
    const effW = wg >= 0 ? clampAxis(wg, clampTo(weight, face.weight)) : master.weight;
    const resolve = (r: VariationRequest | undefined): number[] => {
      const coords = axes.map((a) => a.default);
      // 1. 太さ・幅・傾き
      if (wg >= 0) coords[wg] = effW;
      const wd = at('wdth');
      if (wd >= 0) coords[wd] = clampTo(r?.wdth ?? 100, face.width);
      const it = at('ital');
      const sl = at('slnt');
      // §5.2: ital の軸のある可変フォントは、italic で ital を 1 にする。oblique は slnt (ital は使わない)
      if (r?.ital && it >= 0) coords[it] = 1;
      else if ((r?.ital || r?.slnt !== undefined) && sl >= 0) {
        // slnt の軸は反時計回りが正 (CSS は時計回りが正。§2.4 の注)。書体の持つ CSS の角度の範囲は [-max, -min]
        // @font-face の font-style の範囲があれば、その中 (§7.2: 記述子の値に収めてから、書体の持つ値に収める)
        const lo = Math.max(-axes[sl].max, face.oblique?.[0] ?? -90);
        const hi = Math.min(-axes[sl].min, face.oblique?.[1] ?? 90);
        let angle = 0;
        if (r.ital) {
          // §5.2 の italic: ital が無ければ、11deg 以上の最も小さい oblique、無ければ 11deg より小さい最も大きい oblique (正の角度だけ)
          if (hi >= 11) angle = Math.max(11, lo);
          else if (hi > 0) angle = hi;
        } else angle = Math.min(hi, Math.max(lo, r.slnt!));
        if (angle !== 0) coords[sl] = -angle;
      }
      // 2. 名前つきの実体 (§5.1 の名前の照合: 大文字小文字を区別しない)
      if (face.namedInstance) {
        const n = face.namedInstance.toLowerCase();
        const ni = v.info.instances.find((x) => x.name.toLowerCase() === n);
        if (ni) ni.coords.forEach((c, i) => (coords[i] = c));
      }
      // 3. 記述子の font-variation-settings、4. opsz、5. 性質の font-variation-settings
      const apply = (settings: Record<string, number> | undefined) => {
        for (const [tag, val] of Object.entries(settings ?? {})) {
          const i = at(tag);
          if (i >= 0 && Number.isFinite(val)) coords[i] = val;
        }
      };
      apply(face.settings);
      const op = at('opsz');
      if (op >= 0 && r?.opsz !== undefined) coords[op] = r.opsz;
      apply(r?.settings);
      for (let i = 0; i < coords.length; i++) coords[i] = clampAxis(i, coords[i]);
      return coords;
    };
    const coords = resolve(req);
    const key = `${effW}|${coords.join(',')}`;
    const id = `${master.key}\u0000${key}`;
    const mine = this.handed.get(id);
    if (mine && (mine === master || mine.instanceOf?.master === master)) return mine;
    const hit = v.instances.get(key);
    if (hit) {
      this.handed.set(id, hit);
      return hit;
    }
    const isDefault = coords.every((c, i) => c === axes[i].default);
    // 静的な書体に作り直すか: 既定の形でない実体と、CFF2 の書体のすべての形
    const rebuild = !isDefault || v.info.cff2;
    let lf: LoadedFont;
    if (isDefault && effW === master.weight && !rebuild) lf = master;
    else {
      // 実体の名前: 元の名前 + 「太さだけから決まる値」と違う軸の値 (font-variation-settings の形の印)。この名前と太さで引き直すと、同じ実体になる
      const plain = resolve(undefined);
      const extra: Record<string, number> = {};
      axes.forEach((a, i) => {
        if (coords[i] !== plain[i]) extra[a.tag] = coords[i];
      });
      const coordMap = Object.fromEntries(axes.map((a, i) => [a.tag, coords[i]]));
      const slanted = (coordMap.slnt ?? 0) !== 0 || (coordMap.ital ?? 0) >= 0.5;
      let buffer = master.buffer;
      let fk = master.fk;
      let metrics: ReturnType<typeof fontMetricsOf> = { unitsPerEm: master.unitsPerEm, baselineRatio: master.baselineRatio, ascentMinusDescent: master.ascentMinusDescent, ascent: master.ascent, descent: master.descent };
      if (rebuild) {
        let r: ReturnType<typeof instantiateFont>;
        try {
          r = instantiateFont(master.buffer, v.info, coords);
        } catch (e) {
          if (!v.info.cff2) throw e;
          // CFF2 の表・字形が読めない書体: 実体を作らず、既定の形のまま使う (CFF2 の輪郭は PDF に埋め込める形にできていない)
          v.failed = true;
          const why = e instanceof Error ? e.message : String(e);
          this.onNotice(
            msg(
              `${master.family}: CFF2 の可変フォント (輪郭が CFF2 の OpenType) の実体を作れません (${why})。既定の形 (default instance) で組み、太さ・幅などの軸は効きません。PDF では字が正しく出ないことがあります (TrueType の輪郭の可変フォントか、静的な書体を使ってください)`,
              `${master.family}: cannot instantiate the CFF2 variable font (${why}); the default instance is used and the weight, width and other axes have no effect. Glyphs may not render correctly in the PDF (use a variable font with TrueType outlines, or static fonts)`,
            ),
          );
          return master;
        }
        for (const n of r.notes) this.onNotice(`${master.family}: ${n}`);
        buffer = r.buffer;
        fk = fontkit.create(new Uint8Array(buffer));
        patchFontkitVariationSelector(fk);
        patchFontkitShaping(fk);
        patchFontkitCffFlex(fk);
        prepareColorFont(fk);
        metrics = fontMetricsOf(fk);
      }
      // PostScript 名: 「ファミリー名_値+札…」(既定の値でない軸だけ。Adobe Technical Note #5902 の、名前の無い実体の名前の作り方に倣う)
      const prefix = variationNamePrefix(master.buffer) || (master.postscriptName ?? master.family).replace(/[^A-Za-z0-9-]/g, '');
      const ps = isDefault ? (master.postscriptName ?? prefix) : prefix + axes.map((a, i) => (coords[i] !== a.default ? `_${num(coords[i])}${a.tag.replace(/[^A-Za-z0-9]/g, '')}` : '')).join('');
      lf = {
        key: `${master.key}{${axes.map((a, i) => `${a.tag}=${num(coords[i])}`).join(',')}}`,
        family: master.family + variationSuffix({ settings: extra }),
        weight: effW,
        buffer,
        fk,
        ...metrics,
        postscriptName: ps.slice(0, 127),
        ...(master.fullName ? { fullName: master.fullName } : {}),
        instanceOf: { master, coords: coordMap, ...(slanted ? { slanted: true } : {}) },
      };
      if (this.canvasInstances && rebuild) registerInstanceFace(lf);
    }
    // 元の書体の側に覚える数の上限: 実体のバイト列の合計が 200MB ほどに収まる数 (4〜256)。超えたら古いものから忘れる
    const cap = Math.max(4, Math.min(256, Math.floor(200e6 / Math.max(1, master.buffer.byteLength))));
    while (v.instances.size >= cap) v.instances.delete(v.instances.keys().next().value!);
    v.instances.set(key, lf);
    this.handed.set(id, lf);
    return lf;
  }
  /** lf が可変フォントの元の書体なら、いまの指定 (varNow) と太さの形。ほかの書体はそのまま */
  private use(lf: LoadedFont, weight: number): LoadedFont {
    return lf.variable ? this.instance(lf, weight, this.varNow) : lf;
  }
  /** いま引いている書体の名前に付いていた、軸の値の指定 (get・getForChar・getForCluster の呼び出しの間だけ) */
  private varNow: VariationRequest | undefined;
  private varKey = '';

  /**
   * family + weight に最も近い登録フォントを返す。family 不明なら最初に登録されたファミリ。
   * 名前に軸の値の指定の印 (variationSuffix) が付いていれば、可変フォントは、その指定の実体を返す
   */
  get(family: string | undefined, weight = 400): LoadedFont {
    // 字ごと (PDF の書き出しでは字ごとに 2 度) に呼ばれるので、結果を覚える (下の find は呼ぶたびに配列を作る)
    // 軸の値の指定のある名前を引いている間 (varNow) の、印の無い名前は、指定ごとに分けて覚える
    const memoKey = this.varKey && family !== undefined && family.charCodeAt(family.length - 1) !== 125 ? family + this.varKey : family;
    let byWeight = this.getMemo.get(memoKey);
    if (!byWeight) this.getMemo.set(memoKey, (byWeight = new Map()));
    const memo = byWeight.get(weight);
    if (memo) return memo;
    const r = this.find(family, weight);
    byWeight.set(weight, r);
    return r;
  }
  /** get の結果 (書体名・太さごと)。書体の登録・欧文の書体の指定・書体の組の定義で消す (forCharMemo と同時) */
  private getMemo = new Map<string | undefined, Map<number, LoadedFont>>();
  /** 名前 family の印を外し、その指定を varNow にして fn を呼ぶ (印が無ければ、いまの varNow のまま) */
  private withRequest<T>(family: string | undefined, fn: (plain: string | undefined) => T): T {
    if (family === undefined || family.charCodeAt(family.length - 1) !== 125) return fn(family);
    const [plain, req, suffix] = splitVariation(family);
    if (!req) return fn(family);
    const was = this.varNow;
    const wasKey = this.varKey;
    this.varNow = req;
    this.varKey = suffix;
    try {
      return fn(plain);
    } finally {
      this.varNow = was;
      this.varKey = wasKey;
    }
  }
  private find(family0: string | undefined, weight: number): LoadedFont {
    return this.withRequest(family0, (family) => {
      // 範囲つきの書体の組は、空白 (U+0020) を受け持つ face (後に定義したものから。Fonts 4 §5.2 の first available font)。
      // 字ごとの選び分けは getForChar
      // 順の列を持つ組 (defineStack の list) は、その基本の書体 (別の組の名前・範囲つきの書体の組の名前のこともある) をもう 1 段たどる
      const listed = family ? this.stacks.get(family) : undefined;
      const target = listed?.list ? listed.base : family;
      const loaded = target ? [...(this.ranged.get(target) ?? [])].reverse().filter((f) => [...this.fonts.values()].some((x) => x.family === f.family)) : [];
      const rangedFirst = (loaded.find((f) => !f.ranges || f.ranges.some(([a, b]) => a <= 0x20 && 0x20 <= b)) ?? loaded[loaded.length - 1])?.family;
      const real = rangedFirst ?? (target ? (this.stacks.get(target)?.base ?? target) : target);
      const fam = real && [...this.fonts.values()].some((f) => f.family === real) ? real : this.fallbackFamily;
      if (!fam) throw new Error(msg('フォントが 1 つも登録されていません', 'no font is registered'));
      const faces = [...this.fonts.values()].filter((f) => f.family === fam);
      // 可変フォントのあるファミリーは、太さの範囲で選ぶ (Fonts 4 §5.2)。選んだ書体が可変フォントなら、その太さ・指定の実体
      if (faces.some((f) => f.variable)) return this.use(faces[matchWeightRange(faces.map(weightRangeOf), weight)], weight);
      return faces.find((f) => f.weight === weight) ?? faces[nearestWeightIndex(faces.map((f) => f.weight), weight)];
    });
  }

  /**
   * family の欧文 (ASCII・Latin-1・Latin Extended) を latinFamily のフォントで組む。
   * 日本語フォントの欧文は幅が広く、Times / Arial など欧文フォント前提の組版 (XSL-FO の文書など) と行の長さがずれるため。
   * latinFamily が字形を持たない文字は、元のフォントにフォールバックする。
   */
  /** setLatinFallback で決めた、その書体の欧文の代わりの書体 (無ければ undefined) */
  latinFallbackOf(family: string): string | undefined {
    return this.latinFor.get(family);
  }

  setLatinFallback(family: string, latinFamily: string) {
    this.latinFor.set(family, latinFamily);
    this.forCharMemo.clear();
    this.clusterMemo.clear();
    this.getMemo.clear();
    this.generation++;
  }

  private stacks = new Map<string, { base: string; latin?: string; first?: boolean; symbol?: string; list?: readonly string[] }>();

  /**
   * 範囲つきの書体の組 (CSS の @font-face の unicode-range。Fonts 4 §4.5): 名前 → face の並び (登録した書体名と、受け持つ字の範囲)。
   * 字ごとに、範囲に入り、その字形を持つ最初の face を使う
   */
  private ranged = new Map<string, Array<{ family: string; ranges?: Array<[number, number]> }>>();
  defineRanged(name: string, faces: Array<{ family: string; ranges?: Array<[number, number]> }>) {
    this.ranged.set(name, faces);
    this.forCharMemo.clear();
    this.clusterMemo.clear();
    this.getMemo.clear();
    this.generation++;
  }
  private pickRanged(name: string, weight: number, ch: string): LoadedFont | undefined {
    const faces = this.ranged.get(name);
    if (!faces) return undefined;
    const cp = ch.codePointAt(0) ?? 0;
    // 範囲が重なるときは、後に定義した face から調べる (Fonts 4 §4.5.1)
    for (const f of [...faces].reverse()) {
      if (f.ranges && !f.ranges.some(([a, b]) => cp >= a && cp <= b)) continue;
      if (![...this.fonts.values()].some((x) => x.family === f.family)) continue;
      const lf = this.get(f.family, weight);
      if (this.hasGlyph(lf, ch)) return lf;
    }
    return undefined;
  }

  /**
   * 「欧文は latin、和文は base」という指定に名前 (alias) を付ける。FO の font-family="Times New Roman, MS 明朝" のように、
   * 欧文用と和文用で別のフォントを並べる指定を表す。latin を省けば、base のフォントだけで組む (欧文も base の字形)。
   * first を付けると、latin が持つ字は (欧文に限らず「…」なども) すべて latin で組む (CSS の font-family の並びの先頭の書体)。
   * symbol を付けると、latin が持たない記号 (● など。和文の字・全角の字を除く) を、base より先に symbol の書体で組む (欧文の文書)。
   * list を付けると、順のある書体の列 (CSS の font-family の並び。CSS Fonts 4 §5.2) になる: 字ごとに、列の前から順に、その字を持つ最初の書体を使う (findInList)。
   * 列の項目は、読み込んだ書体のファミリ・範囲つきの書体の組 (defineRanged)・別の組 (総称の写し先の、和文 + 欧文の組) の名前。
   * このとき base は、組の基本の書体 (get が返す書体。行の基準などに使う) を決める名前で、latin は使わない
   */
  defineStack(alias: string, base: string, latin?: string, opts: { first?: boolean; symbol?: string; list?: readonly string[] } = {}) {
    // 同じ定義をもう 1 度しても、覚えた結果 (字ごとの書体・行分け) は消さない (HTML の取り込みは、要素ごとに同じ並びを定義し直す。
    // 順の列は、項目の総称の組も一緒に定義し直すので、そのたびに消すと、取り込みの途中の字の幅の計算が毎回やり直しになる)
    const old = this.stacks.get(alias);
    if (old && old.base === base && old.latin === latin && !!old.first === !!opts.first && old.symbol === (opts.symbol || undefined) && (old.list?.join('\u0000') ?? null) === (opts.list?.join('\u0000') ?? null)) return;
    this.forCharMemo.clear();
    this.clusterMemo.clear();
    this.getMemo.clear();
    this.generation++;
    this.stacks.set(alias, { base, latin, ...(opts.first ? { first: true } : {}), ...(opts.symbol ? { symbol: opts.symbol } : {}), ...(opts.list ? { list: [...opts.list] } : {}) });
  }

  /** その名前の書体 (読み込み済みのファミリ、または defineStack の別名) があるか */
  has(family0: string): boolean {
    const family = splitVariation(family0)[0];
    return this.stacks.has(family) || [...this.fonts.values()].some((f) => f.family === family);
  }

  /** 1 文字のためのフォント (欧文フォントの指定があり、その字形があればそちら) */
  getForChar(family: string | undefined, weight: number, ch: string): LoadedFont {
    // 書体名 → 太さ → 字 の入れ子で引く (呼ぶたびに文字列のキーを組み立てない)
    let byWeight = this.forCharMemo.get(family);
    if (!byWeight) this.forCharMemo.set(family, (byWeight = new Map()));
    let byChar = byWeight.get(weight);
    if (!byChar) byWeight.set(weight, (byChar = new Map()));
    const memo = byChar.get(ch);
    if (memo) return memo;
    const r = this.findForChar(family, weight, ch);
    byChar.set(ch, r);
    return r;
  }
  /** getForChar の結果 (書体名・太さ・字ごと)。書体の登録・欧文の書体の指定・書体の組の定義で消す */
  private forCharMemo = new Map<string | undefined, Map<number, Map<string, LoadedFont>>>();
  /** 書体の登録・欧文の書体・書体の組が変わるたびに増える (行分けの結果を覚えたものが古くなったかを見る) */
  generation = 0;
  private findForChar(family0: string | undefined, weight: number, ch: string): LoadedFont {
    // 欧文の書体で組む語の字 (latinWordFamily の名前): 印を外して、ギリシャ文字・キリル文字も欧文の字として選ぶ
    if (family0?.endsWith(LATIN_WORD)) {
      const was = this.latinWordNow;
      this.latinWordNow = true;
      try {
        return this.findForChar(family0.slice(0, -LATIN_WORD.length) || undefined, weight, ch);
      } finally {
        this.latinWordNow = was;
      }
    }
    return this.withRequest(family0, (family) => this.findForCharPlain(family, weight, ch));
  }
  /** findForChar の本体 (名前の印は外してある。軸の値の指定は varNow) */
  private findForCharPlain(family: string | undefined, weight: number, ch: string): LoadedFont {
    const listed = family ? this.stacks.get(family)?.list : undefined;
    if (listed) return this.findInList(family!, listed, weight, ch);
    if (family && this.ranged.has(family) && !/[\s\u0000-\u001f]/.test(ch)) {
      const r = this.pickRanged(family, weight, ch);
      if (r) return r;
    }
    const base = this.get(family, weight);
    const stack = family ? this.stacks.get(family) : undefined;
    const lf = stack ? stack.latin : this.latinFor.get(base.family);
    // 欧文の書体が範囲つきの書体の組なら、字ごとに face を選ぶ
    if (lf && this.ranged.has(lf) && (this.latinChar(ch) || (stack?.first && !/[\s\u0000-\u001f]/.test(ch)))) {
      const r = this.pickRanged(lf, weight, ch);
      if (r) return r;
    }
    if (lf && (this.latinChar(ch) || (stack?.first && !/[\s\u0000-\u001f]/.test(ch)))) {
      const f = [...this.fonts.values()].some((x) => x.family === lf) ? this.get(lf, weight) : undefined;
      if (f && this.hasGlyph(f, ch)) return f;
    }
    // 欧文の文書の記号: 欧文の書体が持たなければ、和文の書体より先に記号用の欧文の書体で
    if (stack?.symbol && !isCjkChar(ch) && !/\s/.test(ch) && [...this.fonts.values()].some((x) => x.family === stack.symbol)) {
      const f = this.get(stack.symbol, weight);
      if (this.hasGlyph(f, ch)) return f;
    }
    // 基本の書体が持たない字 (ヘブライ語・記号など): 欧文の書体、読み込み済みのほかの書体の順に、その字を持つ書体を探す。
    // 幅を持つ空白 (U+0020・U+00A0・U+3000 など) も同じ: 空白の字形を持たない書体 (絵文字の書体・アイコンの書体など) を指定した行で、
    // 空白を「字が無い」しるしにしない (CSS Fonts 4 §5.2 の書体の選び方に、空白の特別な扱いは無い。HTML の font-family の並び
    // (findInList) と同じ)。改行・タブなどの制御の字は、字形を探さない
    if ((!/[\s\u0000-\u001f]/.test(ch) || WIDE_SPACE.test(ch)) && !this.hasGlyph(base, ch)) {
      const key = `${base.key}|${ch}`;
      let hit = this.charFallback.get(key);
      if (hit === undefined) {
        const cands = [
          ...(lf && [...this.fonts.values()].some((x) => x.family === lf) ? [this.get(lf, weight)] : []),
          ...[...this.fonts.values()].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight)),
        ];
        // 既定で絵文字の表示になる字 (UTS #51) は、色つきの書体を先に探す (色つきの書体が無ければ、順は変わらない)
        hit = orderByPresentation(cands, ch).find((f) => f !== base && f !== base.instanceOf?.master && this.hasGlyph(f, ch)) ?? null;
        this.charFallback.set(key, hit);
      }
      if (hit) return this.use(hit, weight);
    }
    return base;
  }
  /** いま選んでいる字が、欧文の書体で組む語 (ギリシャ文字・キリル文字が 2 字以上続く語) の字か (findForChar・getForCluster の呼び出しの間だけ) */
  private latinWordNow = false;
  /** 欧文の書体 (和欧の混植の組の欧文の側) で組む字か: 欧文の字と、欧文の書体で組む語の中のギリシャ文字・キリル文字 */
  private latinChar(ch: string): boolean {
    // 欧文の語に付く分綴の字 U+2010 (HYPHEN) も、語の字と同じ欧文の書体で (和文の書体の全角のハイフンにしない。inlineFlatten の hyphenAtoms)
    return isLatinForFallback(ch) || (this.latinWordNow && (isGreekCyrillicLetter(ch) || ch === '\u2010'));
  }
  /**
   * 書体の名前 family の、「欧文の書体で組む語の字」用の名前。getForChar・getForCluster に渡すと、和欧の混植の組 (総称・既定の書体、
   * font-family の並びの中のそれら) で、ギリシャ文字・キリル文字を欧文の字と同じに選ぶ (欧文の書体がその字を持てば欧文の書体。
   * 持たなければ、これまでどおりの後備)。混植の組でない書体 (作者が指定した書体・読み込んだ書体) では、何も変わらない
   */
  latinWordFamily(family: string | undefined): string {
    return (family ?? '') + LATIN_WORD;
  }
  /** 基本の書体が持たない字の、代わりの書体 (null は、どの書体も持たない) */
  private charFallback = new Map<string, LoadedFont | null>();

  /** そのファミリの書体が 1 つでも読み込まれているか */
  private isLoaded(family: string): boolean {
    for (const f of this.fonts.values()) if (f.family === family) return true;
    return false;
  }

  /**
   * 順のある書体の列 (defineStack の list) の 1 つの項目が、その字に使う書体 (その項目のどの書体も字を持たなければ undefined)。
   * CSS Fonts 4 §5.2: 並びの名前ごとに、その字の字形があるかを見て、無ければ次の名前へ進む。
   *  - 範囲つきの書体の組: 範囲に入り、字形を持つ face (pickRanged。§5.2 の composite face)
   *  - 別の組・欧文の代わりの書体を持つ書体 (総称の写し先。§2.1.5: 総称は、字の範囲によって別の書体を組み合わせたものでよい):
   *    その組の中の選び方 (欧文の字は欧文の書体、欧文の文書の記号は記号の書体、ほかは基本の書体。findForChar と同じ) で、字形を持つもの
   *  - 読み込んだ書体のファミリ: その書体が字形を持てば、その書体
   * 項目の外 (読み込み済みのほかの書体) へは探しに行かない
   */
  private pickInEntry(entry: string, weight: number, ch: string): LoadedFont | undefined {
    const blank = /[\s\u0000-\u001f]/.test(ch);
    if (this.ranged.has(entry)) {
      if (!blank) return this.pickRanged(entry, weight, ch);
      // 空白は、空白を受け持つ face (get)。face が 1 つも読み込まれていなければ、この項目は無い
      if (!this.ranged.get(entry)!.some((f) => this.isLoaded(f.family))) return undefined;
      const f = this.get(entry, weight);
      return this.hasGlyph(f, ch) ? f : undefined;
    }
    const stack = this.stacks.get(entry);
    const baseName = stack ? stack.base : entry;
    const lf = stack ? stack.latin : this.latinFor.get(baseName);
    if (lf && (this.latinChar(ch) || (stack?.first && !blank))) {
      if (this.ranged.has(lf)) {
        const r = this.pickRanged(lf, weight, ch);
        if (r) return r;
      } else if (this.isLoaded(lf)) {
        const f = this.get(lf, weight);
        if (this.hasGlyph(f, ch)) return f;
      }
    }
    if (stack?.symbol && !isCjkChar(ch) && !/\s/.test(ch) && this.isLoaded(stack.symbol)) {
      const f = this.get(stack.symbol, weight);
      if (this.hasGlyph(f, ch)) return f;
    }
    if (this.isLoaded(baseName)) {
      const f = this.get(baseName, weight);
      if (this.hasGlyph(f, ch)) return f;
    }
    // 基本の書体が持たない字 (記号など) を、欧文の書体が持つとき
    if (lf && !blank && !this.ranged.has(lf) && this.isLoaded(lf)) {
      const f = this.get(lf, weight);
      if (this.hasGlyph(f, ch)) return f;
    }
    return undefined;
  }

  /**
   * 順のある書体の列 (CSS の font-family の並び) から、1 字の書体を選ぶ (CSS Fonts 4 §5.2)。
   *  1. 列の前から順に、その字を持つ最初の項目の書体 (空白も同じ。§5.2 の手順に、空白の特別な扱いは無い)
   *  2. 列のどの項目も持たない字: 読み込み済みのほかの書体 (列に無い書体。§5.2 の installed font fallback に当たる) から、太さの近い順
   *  3. どの書体も持たない字と、どの項目も持たない空白・制御の字: 組の基本の書体 (その書体の「字が無い」しるしになる)
   */
  private findInList(family: string, list: readonly string[], weight: number, ch: string): LoadedFont {
    for (const entry of list) {
      const f = this.pickInEntry(entry, weight, ch);
      if (f) return f;
    }
    if (!/[\s\u0000-\u001f]/.test(ch)) {
      const hit = orderByPresentation([...this.fonts.values()].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight)), ch).find((f) => this.hasGlyph(f, ch));
      if (hit) return this.use(hit, weight);
    }
    return this.get(family, weight);
  }

  /**
   * 字の単位 (書記素クラスタ。基底の字 + 結合文字、絵文字の並びなど) をまとめて組む書体。クラスタは 1 つの書体で組む
   * (基底の字と結合文字を同じ書体で組まないと、結合文字の位置が合わない。CSS Fonts 4 §5.3 Cluster matching)。
   *  1. 基底の字の書体 (getForChar) が、並びの字をすべて持てば、その書体
   *  2. 無ければ、並びのほかの字に選ばれる書体・読み込み済みのほかの書体の順に、並びの字をすべて持つ書体 (絵文字の並びを持つ書体など)。
   *     順のある書体の列 (defineStack の list。CSS の font-family の並び) では、その前に、列の前から順に探す (§5.3 の手順 1)
   *  3. どの書体も並び全体を持たなければ null (呼び出し側が、並びを分けて字ごとに組む)
   * 字形を持たなくてよい字 (描かない字: ZWJ・異体字セレクタ・タグなど。Default_Ignorable_Code_Point) は、持つかどうかを見ない
   */
  getForCluster(family: string | undefined, weight: number, unit: string): LoadedFont | null {
    const key = `${family ?? ''}\u0000${weight}\u0000${unit}`;
    const memo = this.clusterMemo.get(key);
    if (memo !== undefined) return memo;
    const chars = [...unit];
    const need = chars.filter((c, k) => k === 0 || !DEFAULT_IGNORABLE.test(c));
    const covers = (f: LoadedFont) => need.every((c) => this.hasGlyph(f, c));
    const base = this.getForChar(family, weight, chars[0]);
    let hit: LoadedFont | null = base;
    // 異体字セレクタによる表示の指定 (U+FE0F = 絵文字の表示、U+FE0E = 文字の表示。UTS #51 ED-8・ED-9): 基底の字の書体が並びの字を持っていても、
    // 指定と違う種類の書体 (絵文字の表示に、色つきの表の無い書体。文字の表示に、色つきの書体) なら、指定に合う書体をほかから探す
    // (CSS Fonts 4 §5.3: 異体字セレクタの付いた並びは、その並びに合う字形を後備の書体から探してから、基底の字だけで選ぶ)
    const shown = presentationOf(unit);
    const suits = (f: LoadedFont) => !shown?.explicit || (shown.want === 'emoji') === !!colorFontOf(f);
    if (!covers(base) || !suits(base)) {
      // 順のある書体の列 (defineStack の list) は、列の前から順に、並びの字をすべて持つ書体を探す (§5.3 の手順 1: For each family in the font list)
      const latinWord = !!family?.endsWith(LATIN_WORD);
      const named = latinWord ? family!.slice(0, -LATIN_WORD.length) : family;
      hit = this.withRequest(named, (plain) => {
        const list = plain ? this.stacks.get(plain)?.list : undefined;
        const was = this.latinWordNow;
        this.latinWordNow = latinWord;
        let listed: LoadedFont[];
        try {
          listed = list ? list.flatMap((e) => need.map((c) => this.pickInEntry(e, weight, c)).filter((f): f is LoadedFont => !!f)) : [];
        } finally {
          this.latinWordNow = was;
        }
        const cands = [...listed, ...need.slice(1).map((c) => this.getForChar(family, weight, c)), ...[...this.fonts.values()].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))];
        const other = (f: LoadedFont) => f !== base && f !== base.instanceOf?.master;
        const ordered = orderByPresentation(cands, unit);
        // 基底の字の書体が並びを持つのにここへ来るのは、表示の指定 (U+FE0F・U+FE0E) と書体の種類が合わないとき: 合う書体が無ければ、基底の字の書体のまま
        if (covers(base)) {
          const suited = ordered.find((f) => other(f) && covers(f) && suits(f));
          return suited ? this.use(suited, weight) : base;
        }
        const found = ordered.find((f) => other(f) && covers(f));
        return found ? this.use(found, weight) : null;
      });
    }
    if (this.clusterMemo.size > 20000) this.clusterMemo.clear();
    this.clusterMemo.set(key, hit);
    return hit;
  }
  /** getForCluster の結果 (書体名・太さ・並びごと)。forCharMemo と同時に消す */
  private clusterMemo = new Map<string, LoadedFont | null>();

  /** Canvas の ctx.font に渡す文字列 */
  cssFont(font: LoadedFont, sizePx: number): string {
    return `${font.weight} ${sizePx}px "${font.cssFamily ?? font.family}"`;
  }

  hasGlyph(font: LoadedFont, ch: string): boolean {
    const cp = ch.codePointAt(0)!;
    return font.fk.hasGlyphForCodePoint(cp);
  }
}

/** 幅を持つ空白の字 (字形で幅が決まる。改行・タブ・行と段落の区切りは含めない) */
const WIDE_SPACE = /^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$/;

/** 字形を持たなくても描ける字 (書体が組むときに隠す。ZWJ・ZWNJ・異体字セレクタ・タグなど) */
const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;

/** latinWordFamily が書体の名前の後ろに付ける印 */
const LATIN_WORD = '\u0001latin-word';

/**
 * ギリシャ文字・キリル文字の字 (General_Category が L の字): ギリシャ (U+0370〜03FF)・キリル (U+0400〜052F)・Greek Extended (U+1F00〜1FFF)。
 * 字の組の詰め (kern) の対象 (inlineLayout.ts の isLatinAlnumOrPunct) と同じ範囲
 */
export function isGreekCyrillicLetter(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return ((cp >= 0x370 && cp <= 0x52f) || (cp >= 0x1f00 && cp <= 0x1fff)) && /^\p{L}/u.test(ch);
}

/** sfnt ヘッダ (TrueType / OpenType / TTC) の簡易判定。SPA フォールバックの HTML を弾く */
function looksLikeFont(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const tag = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, 4));
  return tag === 'OTTO' || tag === 'true' || tag === 'ttcf' || tag === '\u0000\u0001\u0000\u0000';
}

/** 和文 (中国語・韓国語を含む) の字・全角の字 (仮名・漢字・ハングル・CJK の約物・全角形) */
export function isCjkChar(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xffef) || cp >= 0x20000;
}

/** 欧文フォントで組む文字: ASCII・Latin-1 補助・Latin Extended-A/B・Latin Extended Additional (全角で組まれる記号 × ÷ § ¶ ° ± ¨ ´ は除く) */
export function isLatinForFallback(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || (cp >= 0x100 && cp <= 0x24f)) return !'§¨°±´¶×÷'.includes(ch);
  // Latin Extended Additional (ベトナム語の ế・ệ など、ローマ字の ṃ・ḥ など): 語のほかの字 (ASCII・Latin-1) と同じ欧文の書体で組む
  // (和文の書体がこの範囲の字を持つと、1 つの語の中で書体が混ざる)
  if (cp >= 0x1e00 && cp <= 0x1eff) return true;
  // 欧文の合字 (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ)
  if (cp >= 0xfb00 && cp <= 0xfb06) return true;
  return false;
}

/**
 * 太さの後備 (CSS Fonts 4 §5.2 の font-weight の照合): 同じ太さが無いとき、
 * 400 は 500 → 軽い方 → 重い方、500 は 400 → 軽い方 → 重い方、400 未満は軽い方 → 重い方、500 より重いときは重い方 → 軽い方。
 * weights (登録した書体の太さ。空でない) の中で選ぶものの添え字を返す。同点 (同じ太さが複数) は先に登録したもの
 */
export function nearestWeightIndex(weights: readonly number[], weight: number): number {
  const exact = weights.indexOf(weight);
  if (exact >= 0) return exact;
  const pick = (test: (w: number) => boolean, better: (a: number, b: number) => boolean): number => {
    let best = -1;
    weights.forEach((w, i) => {
      if (test(w) && (best < 0 || better(w, weights[best]))) best = i;
    });
    return best;
  };
  // 軽い方のうち最も近いもの・重い方のうち最も近いもの
  const lighter = (limit: number) => pick((w) => w < limit, (a, b) => a > b);
  const heavier = (limit: number) => pick((w) => w > limit, (a, b) => a < b);
  if (weight === 400 && weights.includes(500)) return weights.indexOf(500);
  if (weight === 500 && weights.includes(400)) return weights.indexOf(400);
  const first = weight > 500 ? heavier(weight) : lighter(weight);
  if (first >= 0) return first;
  const second = weight > 500 ? lighter(weight) : heavier(weight);
  return second >= 0 ? second : 0;
}

/** 書体が選ばれる太さの範囲 (Fonts 4 §4.4・§5.2): 可変フォントは、font-weight の記述子の範囲 ('auto' は登録の太さ。記述子の無い、入っている書体は wght の軸の範囲) */
function weightRangeOf(f: LoadedFont): [number, number] {
  const v = f.variable;
  if (!v) return [f.weight, f.weight];
  if (Array.isArray(v.face.weight)) return v.face.weight;
  const wg = v.info.axes.find((a) => a.tag === 'wght');
  return v.face.weight === 'auto' || !wg ? [f.weight, f.weight] : [wg.min, wg.max];
}

/**
 * 太さの照合 (CSS Fonts 4 §5.2 の font-weight)。太さの範囲 (可変フォント) を持つ face を含む並びから、選ぶものの添え字を返す。
 *  - 求める太さを範囲に含む face があれば、それ (複数あれば先のもの)
 *  - 無ければ: 400〜500 は、求める太さから 500 までを昇順 → 求める太さより軽い方を降順 → 500 より重い方を昇順。
 *    400 未満は、軽い方を降順 → 重い方を昇順。500 より重いときは、重い方を昇順 → 軽い方を降順
 */
export function matchWeightRange(ranges: ReadonlyArray<readonly [number, number]>, weight: number): number {
  const inside = ranges.findIndex(([a, b]) => a <= weight && weight <= b);
  if (inside >= 0) return inside;
  // 範囲が求める太さを含まないので、face は丸ごと軽い方か重い方にある: 重い方は下の端、軽い方は上の端が最も近い値
  const above = (limit: number, max = Infinity) => {
    let best = -1;
    ranges.forEach(([a], i) => {
      if (a > limit && a <= max && (best < 0 || a < ranges[best][0])) best = i;
    });
    return best;
  };
  const below = (limit: number) => {
    let best = -1;
    ranges.forEach(([, b], i) => {
      if (b < limit && (best < 0 || b > ranges[best][1])) best = i;
    });
    return best;
  };
  const order = weight >= 400 && weight <= 500 ? [above(weight, 500), below(weight), above(500)] : weight < 400 ? [below(weight), above(weight)] : [above(weight), below(weight)];
  const hit = order.find((i) => i >= 0);
  return hit ?? 0;
}

/**
 * 可変フォントの実体 (静的な書体にしたもの) を、ブラウザの document.fonts に登録する (Canvas の fillText で描くため)。
 * Canvas では、可変フォントの軸の値を自由には選べない: ctx.font で選べるのは太さだけで、幅は ctx.fontStretch の語 (9 段) だけ、
 * ctx.fontVariationSettings は無い (HTML の CanvasTextDrawingStyles)。そこで、測るのと同じ実体のバイト列を、別の名前の書体として登録する。
 * 読み込みが後で終わるブラウザでは (FontFace.load は非同期)、終わるまで face が無いので、字の輪郭で描く (canvasRenderer.ts)。
 * 測るのは、どちらのときも fontkit の実体 (measurer.ts)。登録する書体も同じバイト列なので、幅は食い違わない
 */
function registerInstanceFace(lf: LoadedFont) {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  try {
    const cssFamily = lf.key;
    const face = new FontFace(cssFamily, lf.buffer.slice(0), { weight: String(Math.min(1000, Math.max(1, lf.weight))) });
    const ready = () => {
      document.fonts.add(face);
      lf.cssFamily = cssFamily;
      lf.face = face;
    };
    // バイト列から作った FontFace は、作った時点で読み込みが済んでいるブラウザがある (Chromium)。そのときは、すぐに使う
    if (face.status === 'loaded') ready();
    else face.load().then(ready, () => undefined);
  } catch {
    // 登録できなければ、輪郭で描く
  }
}
