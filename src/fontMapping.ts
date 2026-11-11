/**
 * fontMapping — 既定の書体の指定と、CSS / XSL-FO の font-family から組版の書体を決める処理 (画面と Node のコマンドで共通)。
 */
import type { FontSpec, LDocument } from './types';
import { fontFileStyle, type FaceStyle, type FontManager, type RangedFace } from './fontManager';
import { SANS, SERIF } from './sampleData';
import { normalizeFamily } from './fontLoader';
import { parseCss, type ParsedCss } from './htmlPaged';

/** 組版用フォント: Google Fonts の gstatic (TTF) を ArrayBuffer として取得。ローカル /fonts を後備に。 */
export const FONT_SPECS: FontSpec[] = [
  {
    family: SERIF,
    weight: 400,
    urls: ['https://fonts.gstatic.com/s/notoserifjp/v34/xn71YHs72GKoTvER4Gn3b5eMRtWGkp6o7MjQ2bwxOubA.ttf', '/fonts/NotoSerifJP-Regular.ttf'],
  },
  {
    family: SANS,
    weight: 400,
    urls: ['https://fonts.gstatic.com/s/notosansjp/v57/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf', '/fonts/NotoSansJP-Regular.ttf'],
  },
  {
    family: SANS,
    weight: 700,
    urls: ['https://fonts.gstatic.com/s/notosansjp/v57/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf', '/fonts/NotoSansJP-Bold.ttf'],
  },
];

/** 欧文用フォント (Times / Arial と字幅互換): 日本語フォントの欧文は幅が広く、FO の見本と行の長さがずれるため */
export const LATIN_SPECS: FontSpec[] = [
  { family: 'Tinos', weight: 400, urls: ['https://fonts.gstatic.com/s/tinos/v26/buE4poGnedXvwgX8.ttf', '/fonts/Tinos-Regular.ttf'] },
  { family: 'Tinos', weight: 700, urls: ['https://fonts.gstatic.com/s/tinos/v26/buE1poGnedXvwj1AW0Fp.ttf', '/fonts/Tinos-Bold.ttf'] },
  { family: 'Arimo', weight: 400, urls: ['https://fonts.gstatic.com/s/arimo/v36/P5sfzZCDf9_T_3cV7NCUECyoxNk37cxsBw.ttf', '/fonts/Arimo-Regular.ttf'] },
  { family: 'Arimo', weight: 700, urls: ['https://fonts.gstatic.com/s/arimo/v36/P5sfzZCDf9_T_3cV7NCUECyoxNk3CstsBw.ttf', '/fonts/Arimo-Bold.ttf'] },
];

/**
 * 等幅の書体 (Courier New と字幅互換)。monospace・Courier などの指定がある文書のときだけ読み込む。
 * 欧文はこの書体、和文は Noto Sans JP で組む
 */
export const MONO_SPECS: FontSpec[] = [
  { family: 'Cousine', weight: 400, urls: ['https://fonts.gstatic.com/s/cousine/v31/d6lIkaiiRdih4SpPzSM.ttf', '/fonts/Cousine-Regular.ttf'] },
  { family: 'Cousine', weight: 700, urls: ['https://fonts.gstatic.com/s/cousine/v31/d6lNkaiiRdih4SpP9Z8K6T4.ttf', '/fonts/Cousine-Bold.ttf'] },
];
/** 等幅の書体の指定 (CSS の monospace・Courier・Consolas など) */
export const MONO = /^(monospace|ui-monospace|courier( new)?|consolas|menlo|monaco|lucida console|source code pro|.*\bmono\b.*)$/i;
/** 等幅の書体の組 (欧文 Cousine・和文は HTML なら Noto Sans JP、XSL-FO なら Noto Serif JP (アンテナハウスと同じ)) */
const MONO_STACK = 'Kumiori Mono';
const MONO_SERIF_STACK = 'Kumiori Mono Serif';

/** 記号の書体 (✈ などの記号)。読み込み済みのどの書体も持たない字が文書にあるときだけ読み込む */
export const SYMBOL_SPEC: FontSpec = {
  family: 'Noto Sans Symbols 2',
  weight: 400,
  urls: ['https://fonts.gstatic.com/s/notosanssymbols2/v25/I_uyMoGduATTei9eI8daxVHDyfisHr71ypM.ttf', '/fonts/NotoSansSymbols2-Regular.ttf'],
};

/**
 * 数式の書体 (OpenType の MATH 表を持つ書体。SIL Open Font License 1.1)。MathML のある文書のときだけ読み込む。
 * MathML の組版 (mathLayout) が、この書体の MATH 表の値と字の輪郭を使う。
 * URL は Google Fonts の CSS (family=STIX+Two+Math) が返したもの (2026-11-01 に確認)
 */
export const MATH_SPEC: FontSpec = {
  family: 'STIX Two Math',
  weight: 400,
  urls: ['https://fonts.gstatic.com/s/stixtwomath/v12/pONg1hwwL_6M9EkZySr_yteUi1o.ttf', '/fonts/STIXTwoMath-Regular.ttf'],
};

/** 文書 (と、external-graphic が指すファイル) に MathML がありそうか */
export const MATHML_HINT = /<([\w-]+:)?math[\s>]|http:\/\/www\.w3\.org\/1998\/Math\/MathML|\.mml\b/;

export const GOTHIC = /ゴシック|gothic|sans|arial|helvetica|verdana|meiryo|メイリオ|yu ?gothic|游ゴシック/i;

/** 明朝系・未指定の太字の書体の別名 (欧文は明朝系の欧文の代わりの書体 (既定は Tinos) の太字、和文は Noto Sans JP の太字) */
export const BOLD_SERIF = 'Kumiori Bold Serif';

/**
 * 文書の文字のうち、読み込み済みのどの書体も字形を持たない字と、その数 (字形の無い字の形 = 豆腐で出る字)。min より小さい符号位置の字は見ない。
 * 空白・制御文字・書式の文字 (ゼロ幅の字・双方向の制御・異体字セレクタなど、字形が無くても見えない字) は数えない
 */
export function missingGlyphChars(fonts: FontManager, doc: LDocument, min = 0): Map<string, number> {
  const TEXT = new Set(['children', 'text', 'baseText', 'rubyText', 'rubyTextUnder', 'label']);
  const chars = new Map<string, number>();
  const invisible = /[\s\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u;
  const walk = (v: unknown, key: string) => {
    if (typeof v === 'string') {
      if (TEXT.has(key)) for (const ch of v) if (ch.codePointAt(0)! >= min && !invisible.test(ch)) chars.set(ch, (chars.get(ch) ?? 0) + 1);
    } else if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(doc, '');
  const all = fonts.all();
  for (const ch of [...chars.keys()]) if (all.some((f) => fonts.hasGlyph(f, ch))) chars.delete(ch);
  return chars;
}

/** 文書の文字に、読み込み済みのどの書体も持たない字 (記号など) があるか。あれば記号の書体 (SYMBOL_SPEC) を読み込む */
export function hasMissingGlyphs(fonts: FontManager, doc: LDocument): boolean {
  return missingGlyphChars(fonts, doc, 0x2000).size > 0;
}

/** 既定の書体を読み込んだ後の設定: 欧文の代わりの書体と、MS 明朝・MS ゴシックの上下の高さ */
export function setupDefaultFonts(fonts: FontManager) {
  fonts.setLatinFallback(SERIF, 'Tinos');
  fonts.setLatinFallback(SANS, 'Arimo');
  // 既定の和文書体 (Noto Serif JP・Noto Sans JP) は、FO の MS 明朝・MS ゴシック (アンテナハウスの既定) の代わり。
  // 字ごとの行の高さの計算 (fontLineMetrics) にも、MS 明朝・MS ゴシックの上下の高さ (ascent 0.859・descent 0.141) を使う
  for (const fam of [SERIF, SANS]) for (const w of [400, 700]) fonts.get(fam, w).ascentMinusDescent = 0.859 - 0.141;
}

/**
 * 書体の名前の登録元。document: 文書と一緒に渡した書体 (XSL-FO の files・画面で読み込んだ書体)、installed: fonts の選択肢・CLI の --font
 * (システムに入れた書体のように使う)、face: HTML の @font-face
 */
export type FontNameSource = 'document' | 'installed' | 'face';

/**
 * 書体の名前 (font-family に書く名前。和名・英名などの別名を含む) → 読み込んだ書体のファミリー名の 1 つの表。
 * 登録元 (FontNameSource) ごとに持ち、引くときにどの登録元をどの順で見るかを決める (XSL-FO の font-family は document → installed、
 * HTML の @font-face は face → installed)。名前の照合は normalizeFamily (全角・空白・大文字小文字・和名の違いを吸収)。
 * 同じ名前が複数あれば先に登録したものを使う。以前は userFonts (FO の files)・installed・htmlFaces の 3 系統が別々の形で持たれていた
 */
export class FontNameTable {
  private tables = new Map<FontNameSource, Map<string, string>>();
  /** 名前 (別名を含む並び。文字列でないもの・空は飛ばす) を family に対応づける。既にある名前は変えない (先のものを使う) */
  add(source: FontNameSource, names: Iterable<unknown>, family: string) {
    let t = this.tables.get(source);
    if (!t) this.tables.set(source, (t = new Map()));
    for (const n of names) {
      if (typeof n !== 'string' || !n) continue;
      const k = normalizeFamily(n);
      if (!t.has(k)) t.set(k, family);
    }
  }
  /** name に当たる書体のファミリー名。sources の順に探す */
  familyFor(name: string, sources: readonly FontNameSource[]): string | undefined {
    const k = normalizeFamily(name);
    for (const s of sources) {
      const f = this.tables.get(s)?.get(k);
      if (f !== undefined) return f;
    }
    return undefined;
  }
  /** sources のどれかに名前が登録されているか */
  has(sources: readonly FontNameSource[]): boolean {
    return sources.some((s) => (this.tables.get(s)?.size ?? 0) > 0);
  }
  /** その登録元の名前をすべて消す (HTML の @font-face を文書ごとに読み直すとき) */
  clear(source: FontNameSource) {
    this.tables.get(source)?.clear();
  }
  /** この表の写し (文書ごとの書体を足しても、元の表に影響しない) */
  fork(): FontNameTable {
    const f = new FontNameTable();
    for (const [s, t] of this.tables) f.tables.set(s, new Map(t));
    return f;
  }
}

/** XSL-FO の font-family (と、HTML で @font-face に当たらない名前) を引く登録元の順 */
const DOCUMENT_SOURCES: readonly FontNameSource[] = ['document', 'installed'];
/** HTML の @font-face の書体を引く登録元の順 */
const FACE_SOURCES: readonly FontNameSource[] = ['face', 'installed'];

/** @font-face の書体のファイル (ブラウザの File と同じ形) */
export interface FontFile {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  /** 文書からの相対パス (fonts/a.woff2)。あれば、@font-face の url() とパスで突き合わせる (無ければファイル名だけ) */
  path?: string;
  /** 参照から取った書体の、参照の URL の全体 (問い合わせの ?… も含む) */
  url?: string;
}

/** %xx を戻す。不正な % の並びは、そのままにする */
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
/** パスの区切りを / にし、. と .. の部分を畳む (fonts/./a.ttf・css/../fonts/a.ttf → fonts/a.ttf)。URL (スキームつき) は区切りだけ */
const normalizePath = (p: string) => {
  const s = p.split('\\').join('/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  const parts: string[] = [];
  for (const seg of s.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
};

/**
 * 書体の割り当てを作る。table: 書体の名前 → ファミリー名の表 (利用者が読み込んだ書体 (MS 明朝など)・fonts で足した書体。@font-face の書体は loadFontFaces がここへ足す)
 */
export function createFontMapping(
  fonts: FontManager,
  table: FontNameTable = new FontNameTable(),
  /** canvas: @font-face の書体をブラウザの document.fonts にも登録するか (画面の canvas の描画に使う。公開 API は書体の輪郭から描くので false) */
  opts: { canvas?: boolean } = {},
) {
  const canvas = opts.canvas ?? true;
  const userFamilyFor = (n: string) => table.familyFor(n, DOCUMENT_SOURCES);
  /** 明朝系・ゴシック系の欧文の書体 (setupDefaultFonts の Tinos・Arimo。CLI の --generic-font で変えられる) */
  const serifLatin = () => fonts.latinFallbackOf(SERIF) ?? 'Tinos';
  const sansLatin = () => fonts.latinFallbackOf(SANS) ?? 'Arimo';
  /** 等幅の指定を割り当てたか (等幅の書体を読み込むかどうか) */
  let monoUsed = false;
  /**
   * FO の font-family の並びから書体を決める。読み込み済みの書体 (MS 明朝など) があればそれを使い、
   * 並びの先頭が別の書体 (Times New Roman など) なら、欧文はそちら (Tinos / Arimo) で、和文は読み込んだ書体で組む。
   */
  function mapFont(names: string[], bold: boolean, monoCjk: string = SERIF): string | undefined {
    if (table.has(DOCUMENT_SOURCES)) {
      const idx = names.findIndex((n) => userFamilyFor(n));
      if (idx >= 0) {
        // 読み込んだ書体が 2 つ以上並ぶ指定 (Times New Roman, MS Mincho など): 順のある書体の列にして、字ごとに、並びの前から順に
        // その字を持つ書体を使う (XSL 1.1 §7.9.2: 並びの書体を、字ごとに順に試す。CSS Fonts 4 §5.2 と同じ)
        const listed = foFontList(names, bold, monoCjk);
        if (listed) return listed;
        const base = userFamilyFor(names[idx])!;
        if (idx === 0) return base;
        // 手前に等幅の指定 (monospace など) があれば、欧文は等幅の Cousine (Courier New と字幅互換)。
        // アンテナハウスも「monospace,MS Mincho」の欧文を Courier New で組む (ext-document-info の見本)
        const before = names.slice(0, idx).map((n) => n.trim().replace(/-/g, ' '));
        const mono = before.some((n) => MONO.test(n));
        if (mono) monoUsed = true;
        const latin = mono ? 'Cousine' : before.some((n) => GOTHIC.test(n)) ? sansLatin() : serifLatin();
        const alias = `${base}+${latin}`;
        fonts.defineStack(alias, base, latin);
        return alias;
      }
    }
    const first = names[0] ?? '';
    // 等幅: 並びの中で最初に見分けられる名前 (等幅・ゴシック・明朝) が等幅なら (source-code-pro, monospace など)、
    // 欧文は Cousine (読み込まれていなければ和文の書体のまま)、和文は monoCjk (XSL-FO は明朝、HTML はゴシック)
    const known = names.map((n) => n.trim().replace(/-/g, ' ')).find((n) => MONO.test(n) || GOTHIC.test(n) || /^(serif|明朝|mincho|times( new roman)?)$|明朝|mincho/i.test(n));
    if (known && MONO.test(known)) {
      monoUsed = true;
      const stack = monoCjk === SANS ? MONO_STACK : MONO_SERIF_STACK;
      fonts.defineStack(stack, monoCjk, 'Cousine', { first: true });
      return stack;
    }
    if (GOTHIC.test(first)) return SANS;
    if (bold) {
      // 明朝系・未指定の太字: 欧文は Tinos の太字 (アンテナハウスの Times New Roman Bold と同じ字幅)、
      // 和文は太字のある Noto Sans JP (明朝の太字・擬似太字は持たない。和文の字幅は変わらない)
      fonts.defineStack(BOLD_SERIF, SANS, serifLatin());
      return BOLD_SERIF;
    }
    // 読み込んだ書体があるときは、親が MS 明朝でも明朝系の指定は Noto Serif に戻す
    return table.has(DOCUMENT_SOURCES) && names.length ? SERIF : undefined;
  }

  /**
   * XSL-FO の font-family の並びを、順のある書体の列にする (読み込んだ書体が 2 つ以上並ぶときだけ。ほかは undefined で、今までの組)。
   * XSL 1.1 §7.9.2 ("a list of fonts ... that are tried in sequence to see if they contain a glyph for a certain character")。
   * 並びの項目の決め方は HTML (htmlFontList) と同じ: 読み込んだ書体はその書体、総称 (serif・sans-serif・monospace) と既定の和文の書体の名前は
   * その位置に写し先の組、既定の欧文の書体の名前と別名 (Times New Roman → Tinos など) はその位置に欧文の書体、ほかの名前は飛ばす。
   * 最後に既定の書体 (飛ばした名前から決める明朝・ゴシック・等幅。無ければ、並びにゴシック系の名前があればゴシック、ほかは明朝)。
   * 組の基本の書体 (行の基準に使う書体) は、並びの先頭の項目 (最初に使える書体)
   */
  function foFontList(names: string[], bold: boolean, monoCjk: string): string | undefined {
    const entries: Array<{ name: string; face: boolean }> = [];
    const skipped: string[] = [];
    for (const n of names) {
      const face = userFamilyFor(n);
      const name = face ?? (isGenericOrDefaultCjk(n) ? mapFont([n], bold, monoCjk) : undefined) ?? knownLatinFamily(n);
      if (!name) skipped.push(n);
      else if (!entries.some((e) => e.name === name)) entries.push({ name, face: !!face });
    }
    if (entries.filter((e) => e.face).length < 2) return undefined;
    const last = mapFont(skipped.length ? skipped : [names.some((n) => GOTHIC.test(n)) ? 'sans-serif' : 'serif'], bold, monoCjk) ?? SERIF;
    const list = entries.map((e) => e.name);
    if (!list.includes(last)) list.push(last);
    const alias = `folist:${list.join('|')}`;
    fonts.defineStack(alias, list[0], undefined, { list });
    return alias;
  }

  /** HTML の @font-face で読み込んだ書体 (loadFontFaces が table の face に登録する)。無ければ fonts で足した書体 */
  const faceOf = (n: string) => table.familyFor(n, FACE_SOURCES);
  /** 読み込み済みの face (「書体名@太さ」) と、そのファイル (ファイルで決まる face だけ。ほかは undefined) */
  const registeredFaces = new Map<string, string | undefined>();

  /**
   * @font-face の書体を、一緒に選んだファイル (src の url のパスで突き合わせ、無ければファイル名で突き合わせる) から読み込む。
   * 斜体・斜めの書体の face (font-style の記述子が italic・oblique) は、同じファミリーの傾きの違う書体として登録し、font-style の指定で選ぶ
   * (CSS Fonts 4 §5.2 の font-style の照合: italic は 斜体 → 斜め → 立体。斜体・斜めの face が無いファミリーは、立体を傾けて描く)。
   * font-width (font-stretch) の記述子のある静的な書体の face も、幅の違う書体として登録し、font-stretch の指定で選ぶ (§5.2 の font-width の照合)。
   * 記述子が範囲のときは、標準の幅 (100%) に最も近い値の書体として扱う。記述子の無い face は、標準の幅 (書体のファイルの幅は見ない。§4.4 の auto)
   *
   * 同じ font-family で、記述子の組 (太さ・unicode-range) が同じ face が並ぶとき (CSS Fonts 4):
   *  - §4.4: font-weight の記述子が無い (auto) face は、選ぶときは normal (400) として扱う (書体のファイルの太さでは選ばない)
   *  - §4.5・§5.2: 記述子の同じ face は 1 つの組 (composite face) になり、字ごとに、後に定義したものから調べる
   *    (後の定義の書体が持たない字は、先の定義の書体)。太らせて描くかどうかも、記述子の太さで決まる (§4.4)
   * 同じファイルを指す繰り返しは、1 つの face として扱う。
   *
   * opts.ahFaceWeight (アンテナハウス互換。--style ah): font-weight の記述子の無い face を、書体のファイルの太さ (OS/2 の usWeightClass) で登録する。
   * アンテナハウスの出力では、同じ名前で記述子の無い @font-face に Regular・Bold・Heavy のファイルを並べた文書 (『CSS ページ組版入門』第 4 版の
   * source-han-sans・source-han-serif) の太字が、それぞれの太さのファイルで組まれる (公開の説明 https://www.antenna.co.jp/AHF/help/ja/ahf-ext.html#axf.font-face
   * は font-weight の初期値を normal としているが、出力の PDF に埋め込まれた書体は、ファイルの太さで使い分けたもの)。
   * 可変フォントと、太さの読めない書体は、標準と同じ (400)。
   * 同じ考えで、font-style の記述子の無い face は、書体のファイルの傾き (OS/2 の fsSelection の ITALIC・OBLIQUE) で登録する
   * (記述子なしで斜体のファイルを指した face は、斜体の書体として font-style: italic の字に使う。標準では立体の face: §4.4 の auto は、選ぶときは normal)
   */
  async function loadFontFaces(css: string | ParsedCss, files: FontFile[], opts: { ahFaceWeight?: boolean } = {}) {
    table.clear('face');
    const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
    // src の url() は、CSS の場所を基準に解決した参照 (CSS Fonts 4 §4.3。CSS のファイルの中の相対参照は、prepareHtml が解決済みにしている)。
    // まず参照の URL の全体 (参照から取った書体)、次にパス (文書からの相対パス) で探し、無いときだけファイル名で探す
    // (noto/Regular.woff2 と roboto/Regular.woff2 を取り違えない)。同じ鍵のファイルが複数あれば、先のもの
    const byUrl = new Map<string, FontFile>();
    const byPath = new Map<string, FontFile>();
    for (const f of files) {
      if (f.url !== undefined && !byUrl.has(f.url)) byUrl.set(f.url, f);
      if (f.path !== undefined && !byPath.has(normalizePath(f.path))) byPath.set(normalizePath(f.path), f);
    }
    const fileOf = (u: string) => byUrl.get(u) ?? byPath.get(normalizePath(safeDecode(u.split(/[?#]/)[0]))) ?? byName.get(safeDecode(u.split(/[?#]/)[0].split('/').pop() ?? '').toLowerCase());
    // ファミリごとの face の並び。unicode-range の違う face は、別の名前で登録し、範囲つきの書体の組にまとめる (Fonts 4 §4.5)
    const groups = new Map<string, RangedFace[]>();
    // この文書で定義した face (「書体名@太さ」) ごとの、定義に使ったファイルの並び (書いた順)
    const defined = new Map<string, FontFile[]>();
    for (const ff of (typeof css === 'string' ? parseCss(css) : css).fontFaces) {
      const file = ff.srcs.map(fileOf).find(Boolean);
      if (!file) continue;
      const rangeKey = ff.ranges ? ff.ranges.map(([a, b]) => `${a}-${b}`).join(',') : '';
      const first = rangeKey ? `css:${ff.family}#${rangeKey}` : `css:${ff.family}`;
      try {
        // アンテナハウス互換: font-weight の記述子の無い face は、書体のファイルの太さで登録する (可変フォント・太さの読めない書体は 400 のまま)
        let weight = ff.weight;
        let sfnt: ArrayBuffer | undefined;
        // 書体そのものの傾き (font-style の記述子) と幅 (font-width の記述子。範囲は、100% に最も近い値)
        let style: FaceStyle | undefined = ff.italic ? (ff.oblique ? 'oblique' : 'italic') : undefined;
        let width = ff.widthRange ? Math.min(ff.widthRange[1], Math.max(ff.widthRange[0], 100)) : undefined;
        if (width === 100) width = undefined;
        if (opts.ahFaceWeight && (!ff.weightRange || ff.styleAuto)) {
          const st = fontFileStyle(await file.arrayBuffer());
          sfnt = st.sfnt;
          if (!ff.weightRange && !st.variable && st.weight !== undefined) weight = st.weight;
          // アンテナハウス互換: font-style の記述子の無い face は、書体のファイルの傾きで登録する
          if (ff.styleAuto && !st.variable && st.style) style = st.style;
        }
        // 可変フォントの幅は、軸と記述子の範囲で決まる (FontManager の instance)。静的な書体だけ、幅の違う書体として登録する
        if (width !== undefined && (sfnt ? fontFileStyle(sfnt).variable : fontFileStyle(await file.arrayBuffer()).variable)) width = undefined;
        const shapeKey = `${style ? `/${style}` : ''}${width !== undefined ? `/w${width}` : ''}`;
        // 記述子の組 (太さ・範囲) が同じ face の 2 つ目からは、別の名前 (…~2・…~3) で登録し、先の定義の face に重ねる (§4.5・§5.2)。
        // 同じファイルの繰り返しは、足さない
        const slot = `${first}@${weight}${shapeKey}`;
        const earlier = defined.get(slot) ?? [];
        if (earlier.includes(file)) continue;
        defined.set(slot, [...earlier, file]);
        const family = earlier.length ? `${first}~${earlier.length + 1}` : first;
        // 読み込み済みなら読み直さない (最初の定義は「書体名@太さ」だけで見る: 今までと同じ)。ファイルで決まるもの
        // (後の定義・ファイルの太さで登録したもの) は、同じファイルのときだけ
        const key = `${family}@${weight}${shapeKey}`;
        const fileId = earlier.length || sfnt ? (file.url ?? file.path ?? file.name) : undefined;
        if (!registeredFaces.has(key) || (fileId !== undefined && registeredFaces.get(key) !== fileId)) {
          // 可変フォントの記述子 (Fonts 4 §4.4: 記述子が無い (auto) ときは、選ぶときは normal、軸の値は制限しない)
          const lf = await fonts.registerBuffer(family, weight, sfnt ?? (await file.arrayBuffer()), canvas, {
            weight: ff.weightRange ?? 'auto',
            width: ff.widthRange ?? 'auto',
            ...(ff.obliqueRange ? { oblique: ff.obliqueRange } : {}),
            ...(ff.variationSettings ? { settings: ff.variationSettings } : {}),
            ...(ff.namedInstance ? { namedInstance: ff.namedInstance } : {}),
          }, style || width !== undefined ? { ...(style ? { style } : {}), ...(width !== undefined ? { width } : {}) } : undefined);
          // line-height: normal の行の高さを、書体の値から決める書体 (htmlNormalLineHeight と同じ。代わりの書体として使われたときも)
          lf.metricsLineHeight = true;
          registeredFaces.set(key, fileId);
        }
        const g = groups.get(ff.family) ?? [];
        const same = earlier.length ? { family: first, weight, ...(style ? { style } : {}), ...(width !== undefined ? { width } : {}) } : undefined;
        if (!g.some((x) => x.family === family && x.same?.weight === same?.weight && x.same?.style === same?.style && x.same?.width === same?.width)) g.push({ family, ...(ff.ranges ? { ranges: ff.ranges } : {}), ...(same ? { same } : {}) });
        groups.set(ff.family, g);
      } catch (e) {
        console.warn(`@font-face ${ff.family}: ${String(e)}`);
      }
    }
    for (const [fam, faces] of groups) {
      // face が 1 つで範囲も無ければ、その書体そのもの。複数か範囲つきなら、範囲つきの書体の組
      if (faces.length === 1 && !faces[0].ranges) table.add('face', [fam], faces[0].family);
      else {
        const name = `css:${fam}#ranged`;
        fonts.defineRanged(name, faces);
        table.add('face', [fam], name);
      }
    }
  }

  /** HTML の font-family: @font-face の書体を先に探し (和文は Noto)、無ければ XSL-FO と同じ選び方 */
  /**
   * line-height: normal: 最初に使える書体 (CSS Inline 3 §5.3 の first available font) が @font-face で読み込んだ書体なら、その書体の上下の高さと
   * 行間 (hhea) から。ほかは undefined (1.2)。並びの中で、読み込んだ書体より前に総称・既定の書体の名前があるときは、最初に使える書体は
   * 既定の書体 (htmlFontList の並びの先頭) なので undefined。後ろに並ぶ書体の字は、組まれた行でその書体の上下を数える (fontManager.ts の normalLineBounds)
   */
  function htmlNormalLineHeight(names: string[], bold: boolean): number | undefined {
    const idx = names.findIndex((n) => faceOf(n));
    if (idx < 0) return undefined;
    if (names.slice(0, idx).some((n) => isGenericOrDefaultCjk(n) || knownLatinFamily(n))) return undefined;
    const f = fonts.get(faceOf(names[idx])!, bold ? 700 : 400);
    const hh = (f.fk as unknown as { hhea?: { ascent: number; descent: number; lineGap: number } }).hhea;
    return hh ? (hh.ascent - hh.descent + hh.lineGap) / f.unitsPerEm : undefined;
  }

  /**
   * font-family の並びの中の位置で引く総称 (CSS Fonts 4 §2.1.5)。serif・sans-serif・monospace は、必ず書体に写す総称
   * ("must always map to at least one matched font face")。ui-* は、同じ写し先にする。
   * ほかの総称 (cursive・fantasy・system-ui・emoji・math・fangsong など) は、当たる書体を持たないので、読み込んでいない書体の名前と同じに飛ばす
   */
  const POSITIONED_GENERIC = /^(serif|sans-serif|monospace|ui-serif|ui-sans-serif|ui-monospace)$/i;
  /**
   * 既定の書体の名前と、その代わりに使う欧文の書体の別名 (§5.2: 名前は @font-face の書体、次に入っている書体から探す。入っている書体には別名を含めてよい)。
   * 既定の和文の書体の名前は、総称と同じ写し先 (和文 + 欧文の組)。欧文の書体の名前 (Tinos・Arimo・Cousine) と、字幅を合わせてある相手の名前
   * (Times New Roman・Arial・Courier New など) は、欧文の書体そのもの (和文の字は、並びの後ろの書体へ進む)
   */
  const knownLatinFamily = (n: string): string | undefined => {
    const k = normalizeFamily(n);
    if (k === 'tinos' || k === 'arimo') return k === 'tinos' ? 'Tinos' : 'Arimo';
    if (k === 'timesnewroman' || k === 'times') return serifLatin();
    if (k === 'arial' || k === 'helvetica') return sansLatin();
    if (k === 'cousine' || k === 'couriernew' || k === 'courier') {
      monoUsed = true;
      return 'Cousine';
    }
    return undefined;
  };
  /** 総称・既定の和文の書体の名前か (その位置に、いまの写し先の和文 + 欧文の組を置く名前) */
  const isGenericOrDefaultCjk = (n: string) => POSITIONED_GENERIC.test(n.trim()) || [SERIF, SANS].some((f) => normalizeFamily(f) === normalizeFamily(n));

  /**
   * font-family の並びを、順のある書体の列にする (CSS Fonts 4 §5.2: 並びの名前を前から順に見て、字ごとに、その字を持つ最初の書体を使う)。
   *  - 読み込んだ書体 (@font-face・fonts / --font の書体) の名前: その書体
   *  - 総称 (POSITIONED_GENERIC)・既定の和文の書体の名前: その位置に、いまの写し先 (和文 + 欧文の組。その名前だけを指定したときと同じ)
   *  - 既定の欧文の書体の名前と別名 (knownLatinFamily): その位置に、欧文の書体
   *  - ほかの名前 (読み込んでいない書体): 飛ばす (§5.2)
   *  - 最後に、既定の書体 (並びの名前が尽きた後の後備。飛ばした名前がゴシック系・等幅なら、その写し先。無ければ、並びの名前から決める明朝・ゴシック)
   * 並びのどれも持たない字は、その後に、並びに無い読み込み済みの書体 (FontManager.findInList)。
   *
   * この列を使うのは、読み込んだ書体より前に総称・既定の書体の名前があるときと、読み込んだ書体が 2 つ以上並ぶときだけ。
   * 読み込んだ書体が先頭に 1 つのとき (と、読み込んだ書体が無いとき) は undefined を返し、今までの組 (先頭の書体 + 和文の書体) で組む
   * (先頭の書体が持つ字はその書体、ほかは後ろの総称の和文の書体。これまでの文書の結果を変えない)
   */
  function htmlFontList(names: string[], bold: boolean, lang: string | undefined, fallback: string): string | undefined {
    const entries: Array<{ name: string; kind: 'face' | 'pair' | 'latin' }> = [];
    const skipped: string[] = [];
    for (const n of names) {
      const face = faceOf(n);
      const pair = !face && isGenericOrDefaultCjk(n) ? mapHtmlFont([n], bold, lang) : undefined;
      const name = face ?? pair ?? knownLatinFamily(n);
      if (!name) skipped.push(n);
      else if (!entries.some((e) => e.name === name)) entries.push({ name, kind: face ? 'face' : pair ? 'pair' : 'latin' });
    }
    const faces = entries.filter((e) => e.kind === 'face').length;
    if (faces < 2 && !(faces === 1 && entries[0].kind !== 'face')) return undefined;
    const last = mapHtmlFont(skipped.length ? skipped : [fallback], bold, lang) ?? SERIF;
    const list = entries.map((e) => e.name);
    if (!list.includes(last)) list.push(last);
    // 組の基本の書体 (行の基準などに使う書体): 並びの中の最初の総称・既定の和文の書体の組 (読み込んだ書体 1 つ + 総称のときの「和文の書体」と同じ)
    const base = entries.find((e) => e.kind === 'pair')?.name ?? last;
    const alias = `list:${list.join('|')}`;
    fonts.defineStack(alias, base, undefined, { list });
    return alias;
  }

  function mapHtmlFont(names: string[], bold: boolean, lang?: string): string | undefined {
    // 欧文の文書 (lang が日本語・中国語・韓国語でない) では、欧文の書体に無い記号 (● など) を和文の全角の字でなく、
    // 欧文の書体 (ゴシック系は Arimo、ほかは Tinos。アンテナハウスの Arial / Times と同じ字幅) で組む
    const latinDoc = !!lang && !/^(ja|zh|ko)\b/i.test(lang);
    const sym = names.some((n) => GOTHIC.test(n) && !/serif/i.test(n.replace(/sans-serif/i, ''))) ? sansLatin() : serifLatin();
    const idx = names.findIndex((n) => faceOf(n));
    if (idx >= 0) {
      const listed = htmlFontList(names, bold, lang, sym === sansLatin() ? 'sans-serif' : 'serif');
      if (listed) return listed;
      const face = faceOf(names[idx])!;
      // 和文の字 (読み込んだ書体に無い字) は、並びの次の名前で組む (Fonts 4 の書体の選び方: 字の無い書体は飛ばして次の名前へ)。
      // 後に並ぶ名前で最初に見分けられるもの (sans-serif・serif・ゴシック・明朝・等幅) がゴシック系・等幅なら Noto Sans JP、
      // 明朝系なら Noto Serif JP。後に見分けられる名前が無ければ、ファミリ名がゴシック系なら Noto Sans JP、それ以外は Noto Serif JP
      const next = names
        .slice(idx + 1)
        .map((n) => n.trim().replace(/-/g, ' '))
        .find((n) => MONO.test(n) || GOTHIC.test(n) || /^(serif|times( new roman)?)$|明朝|mincho/i.test(n));
      // 並びの後ろに、読み込んだ書体 (@font-face・--font の書体。MS 明朝など) があれば、和文の字はその書体で組む
      const laterFace = names.slice(idx + 1).map((n) => faceOf(n)).find((f) => f && f !== face);
      const cjk = laterFace ?? (next ? (MONO.test(next) || GOTHIC.test(next) ? SANS : SERIF) : sym === sansLatin() ? SANS : SERIF);
      const alias = `${face}+${cjk}${latinDoc ? `+${sym}` : ''}`;
      fonts.defineStack(alias, cjk, face, { first: true, ...(latinDoc ? { symbol: sym } : {}) });
      return alias;
    }
    // 読み込んだ書体の無い指定 (serif など) は、既定の書体を明示する (親の @font-face の書体を受け継がない)
    const fam = mapFont(names, bold, SANS) ?? (names.length ? SERIF : undefined);
    if (latinDoc && (fam === SERIF || fam === SANS)) {
      const latin = fam === SANS ? sansLatin() : serifLatin();
      const alias = `${fam}+${latin}`;
      fonts.defineStack(alias, fam, latin, { symbol: latin });
      return alias;
    }
    return fam;
  }

  return { mapFont, mapHtmlFont, htmlNormalLineHeight, loadFontFaces, usesMono: () => monoUsed };
}
