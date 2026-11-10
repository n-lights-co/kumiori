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
}

const keyOf = (family: string, weight: number) => `${family}@${weight}`;

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

  /** 既に読み込み済みの ArrayBuffer を登録 (Node テストやローカルファイル用) */
  async registerBuffer(family: string, weight: number, buffer: ArrayBuffer, canvas = true): Promise<LoadedFont> {
    // WOFF・WOFF2 は、ふつうの書体のファイル (TTF・OTF) に戻してから登録する (PDF にはそのまま埋め込めない。webFont.ts)。
    // 書体の集まり (TTC と、WOFF2 の書体の集まりを戻したもの) は、最初の書体を使う (@font-face で集まりを指したとき)
    buffer = toSfnt(buffer);
    if (isCollection(buffer)) buffer = collectionFaces(buffer)[0];
    this.charFallback.clear();
    this.forCharMemo.clear();
    this.clusterMemo.clear();
    this.getMemo.clear();
    this.generation++;
    const fk = fontkit.create(new Uint8Array(buffer));
    patchFontkitVariationSelector(fk);
    patchFontkitShaping(fk);
    const upm = fk.unitsPerEm || 1000;
    // OS/2 typo メトリクスが ちょうど 1em を成すフォント (Noto CJK 等) は ideographic em ボックスと一致する
    const os2 = (fk as unknown as { 'OS/2'?: { typoAscender: number; typoDescender: number } })['OS/2'];
    let baselineRatio = 0.88;
    if (os2 && Math.abs(os2.typoAscender - os2.typoDescender - upm) < upm * 0.02) {
      baselineRatio = os2.typoAscender / upm;
    } else if (typeof os2?.typoAscender !== 'number' && typeof fk.ascent === 'number' && typeof fk.descent === 'number' && fk.ascent > 0) {
      // OS/2 の表 (typo の値) の無い書体 (古い TrueType): hhea の上下 (A・D) で、CSS 2.1 §10.8.1 と同じ基準線の位置にする。
      // 行の上端から基準線までは 半行間 + A = LH/2 + (A − D)/2 なので、em の箱では比 0.5 + (A − D)/2 (em) に当たる
      baselineRatio = 0.5 + (fk.ascent + fk.descent) / (2 * upm);
    }
    let face: FontFace | undefined;
    if (canvas && typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
      face = new FontFace(family, buffer.slice(0), { weight: String(weight) });
      await face.load();
      document.fonts.add(face);
    }
    const asc = Math.abs(fk.ascent ?? upm * 0.88) / upm;
    const desc = Math.abs(fk.descent ?? upm * 0.12) / upm;
    const names = fk as unknown as { postscriptName?: string; fullName?: string };
    const lf: LoadedFont = {
      key: keyOf(family, weight),
      family,
      weight,
      buffer,
      face,
      fk,
      unitsPerEm: upm,
      baselineRatio,
      ascentMinusDescent: asc - desc,
      ascent: asc,
      descent: desc,
      ...(names.postscriptName ? { postscriptName: names.postscriptName } : {}),
      ...(names.fullName ? { fullName: names.fullName } : {}),
    };
    this.fonts.set(lf.key, lf);
    this.getMemo.clear(); // face.load() の await の間に get が呼ばれていることがある
    if (!this.fallbackFamily) this.fallbackFamily = family;
    return lf;
  }

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

  all(): LoadedFont[] {
    return [...this.fonts.values()];
  }

  /** family + weight に最も近い登録フォントを返す。family 不明なら最初に登録されたファミリ */
  get(family: string | undefined, weight = 400): LoadedFont {
    // 字ごと (PDF の書き出しでは字ごとに 2 度) に呼ばれるので、結果を覚える (下の find は呼ぶたびに配列を作る)
    let byWeight = this.getMemo.get(family);
    if (!byWeight) this.getMemo.set(family, (byWeight = new Map()));
    const memo = byWeight.get(weight);
    if (memo) return memo;
    const r = this.find(family, weight);
    byWeight.set(weight, r);
    return r;
  }
  /** get の結果 (書体名・太さごと)。書体の登録・欧文の書体の指定・書体の組の定義で消す (forCharMemo と同時) */
  private getMemo = new Map<string | undefined, Map<number, LoadedFont>>();
  private find(family: string | undefined, weight: number): LoadedFont {
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
    return faces.find((f) => f.weight === weight) ?? faces[nearestWeightIndex(faces.map((f) => f.weight), weight)];
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
  has(family: string): boolean {
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
    const family = family0;
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
    // 基本の書体が持たない字 (ヘブライ語・記号など): 欧文の書体、読み込み済みのほかの書体の順に、その字を持つ書体を探す
    if (!/[\s\u0000-\u001f]/.test(ch) && !this.hasGlyph(base, ch)) {
      const key = `${base.key}|${ch}`;
      let hit = this.charFallback.get(key);
      if (hit === undefined) {
        const cands = [
          ...(lf && [...this.fonts.values()].some((x) => x.family === lf) ? [this.get(lf, weight)] : []),
          ...[...this.fonts.values()].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight)),
        ];
        hit = cands.find((f) => f !== base && this.hasGlyph(f, ch)) ?? null;
        this.charFallback.set(key, hit);
      }
      if (hit) return hit;
    }
    return base;
  }
  /** いま選んでいる字が、欧文の書体で組む語 (ギリシャ文字・キリル文字が 2 字以上続く語) の字か (findForChar・getForCluster の呼び出しの間だけ) */
  private latinWordNow = false;
  /** 欧文の書体 (和欧の混植の組の欧文の側) で組む字か: 欧文の字と、欧文の書体で組む語の中のギリシャ文字・キリル文字 */
  private latinChar(ch: string): boolean {
    return isLatinForFallback(ch) || (this.latinWordNow && isGreekCyrillicLetter(ch));
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
      const hit = [...this.fonts.values()].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight)).find((f) => this.hasGlyph(f, ch));
      if (hit) return hit;
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
    if (!covers(base)) {
      // 順のある書体の列 (defineStack の list) は、列の前から順に、並びの字をすべて持つ書体を探す (§5.3 の手順 1: For each family in the font list)
      const latinWord = !!family?.endsWith(LATIN_WORD);
      const plain = latinWord ? family!.slice(0, -LATIN_WORD.length) : family;
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
      hit = cands.find((f) => f !== base && covers(f)) ?? null;
    }
    if (this.clusterMemo.size > 20000) this.clusterMemo.clear();
    this.clusterMemo.set(key, hit);
    return hit;
  }
  /** getForCluster の結果 (書体名・太さ・並びごと)。forCharMemo と同時に消す */
  private clusterMemo = new Map<string, LoadedFont | null>();

  /** Canvas の ctx.font に渡す文字列 */
  cssFont(font: LoadedFont, sizePx: number): string {
    return `${font.weight} ${sizePx}px "${font.family}"`;
  }

  hasGlyph(font: LoadedFont, ch: string): boolean {
    const cp = ch.codePointAt(0)!;
    return font.fk.hasGlyphForCodePoint(cp);
  }
}

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
