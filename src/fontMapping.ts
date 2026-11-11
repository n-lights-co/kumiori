/**
 * fontMapping — 既定の書体の指定と、CSS / XSL-FO の font-family から組版の書体を決める処理 (画面と Node のコマンドで共通)。
 */
import type { FontSpec, LDocument } from './types';
import { fontFileStyle, type FaceStyle, type FontManager, type RangedFace } from './fontManager';
import { MONO_GENERIC, SANS, SERIF } from './sampleData';
import { normalizeFamily } from './fontLoader';
import { parseCss, type ParsedCss } from './htmlPaged';

/**
 * 組版用フォント (和文): Google Fonts の gstatic (TTF) を ArrayBuffer として取得。ローカル /fonts を後備に。
 * 明朝・ゴシックのそれぞれに、標準 (400) と太字 (700)。同じファミリーは、標準を先に並べる (太字の枠が標準と同じ中身かを見る: FontManager.registerDefaults)
 */
export const FONT_SPECS: FontSpec[] = [
  {
    family: SERIF,
    weight: 400,
    urls: ['https://fonts.gstatic.com/s/notoserifjp/v34/xn71YHs72GKoTvER4Gn3b5eMRtWGkp6o7MjQ2bwxOubA.ttf', '/fonts/NotoSerifJP-Regular.ttf'],
  },
  // 明朝の太字。太字の指定の字は、同じファミリーの太い書体で組む (CSS Fonts 4 §5.2 の font-weight の照合・XSL 1.1 §7.9.9。別のファミリーに替えない: mapFont)。
  // URL は Google Fonts の CSS (family=Noto+Serif+JP:wght@700) が返したもの (Regular と同じ v34。2026-11-11 に確認)
  {
    family: SERIF,
    weight: 700,
    urls: ['https://fonts.gstatic.com/s/notoserifjp/v34/xn71YHs72GKoTvER4Gn3b5eMRtWGkp6o7MjQ2bzWPebA.ttf', '/fonts/NotoSerifJP-Bold.ttf'],
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
const MONO_STACK = MONO_GENERIC;
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

/**
 * 差し替えられる総称の書体 (API の genericFonts・コマンドの --generic-font の名前)。CSS Fonts 4 §2.1.3: 総称の書体に当てる書体は、
 * 処理系が決める (利用者が選べてよい)。Kumiori の総称の書体は、和文の書体と欧文の書体の組 (§2.1.5: 総称は、字の範囲によって
 * 別の書体を組み合わせたものでよい) なので、欧文と和文を別々に差し替える:
 *  - serif・sans-serif・monospace: 欧文の字の書体 (既定は Tinos・Arimo・Cousine)
 *  - serif-cjk・sans-serif-cjk: 和文 (欧文の書体に無い字) の書体 (既定は Noto Serif JP・Noto Sans JP)。
 *    等幅の和文の書体は、等幅の和文の既定 (HTML はゴシック、XSL-FO は明朝) の側の書体になる
 * ui-serif・ui-sans-serif・ui-monospace は、serif・sans-serif・monospace と同じ写し先 (createFontMapping の POSITIONED_GENERIC)。
 * ほかの総称 (cursive・fantasy・system-ui・math など) は、当てる書体を持たない
 */
export const GENERIC_FONT_KEYS = ['serif', 'sans-serif', 'monospace', 'serif-cjk', 'sans-serif-cjk'] as const;
export type GenericFontKey = (typeof GENERIC_FONT_KEYS)[number];

/**
 * 総称の書体を差し替える (family は読み込み済みの書体のファミリー名)。欧文の書体 (serif・sans-serif) を先に、和文の書体を後に呼ぶ
 * (和文の書体の組は、そのときの欧文の書体を持つ)。
 * 和文の書体は、既定の和文の書体の名前 (Noto Serif JP・Noto Sans JP) を、family と欧文の書体の組 (defineStack) にする。
 * 既定の和文の書体は読み込んだままにし、family に無い字は、そちらで組む (読み込み済みの書体から字を探す)
 */
export function setGenericFont(fonts: FontManager, key: GenericFontKey, family: string) {
  if (key === 'serif') fonts.setLatinFallback(SERIF, family);
  else if (key === 'sans-serif') fonts.setLatinFallback(SANS, family);
  else if (key === 'monospace') fonts.setLatinFallback(MONO_STACK, family);
  else {
    const cjk = key === 'serif-cjk' ? SERIF : SANS;
    // 既定の和文の書体の名前 (serif-cjk=Noto Sans JP など) は、その名前もまた組になりうるので、いまの書体を指す別名で持つ
    let base = family;
    if (family === SERIF || family === SANS) fonts.addFamilyAliasOf((base = `Kumiori Generic ${family}`), family);
    fonts.defineStack(cjk, base, fonts.latinFallbackOf(cjk));
  }
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
 * @font-face の src の url() から、一緒に選んだファイルを引く関数 (loadFontFaces と faceFileWeights で共通)。
 * src の url() は、CSS の場所を基準に解決した参照 (CSS Fonts 4 §4.3。CSS のファイルの中の相対参照は、prepareHtml が解決済みにしている)。
 * まず参照の URL の全体 (参照から取った書体)、次にパス (文書からの相対パス) で探し、無いときだけファイル名で探す
 * (noto/Regular.woff2 と roboto/Regular.woff2 を取り違えない)。同じ鍵のファイルが複数あれば、先のもの
 */
function faceFileResolver(files: FontFile[]): (u: string) => FontFile | undefined {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const byUrl = new Map<string, FontFile>();
  const byPath = new Map<string, FontFile>();
  for (const f of files) {
    if (f.url !== undefined && !byUrl.has(f.url)) byUrl.set(f.url, f);
    if (f.path !== undefined && !byPath.has(normalizePath(f.path))) byPath.set(normalizePath(f.path), f);
  }
  return (u) => byUrl.get(u) ?? byPath.get(normalizePath(safeDecode(u.split(/[?#]/)[0]))) ?? byName.get(safeDecode(u.split(/[?#]/)[0].split('/').pop() ?? '').toLowerCase());
}

/**
 * @font-face の書体ファミリーごとの、face の太さの並び (アンテナハウス互換の bolder・lighter を決める: compat.ts の ahCascadeOptions)。
 * font-weight の記述子の無い face は、書体のファイルの太さ (OS/2 の usWeightClass。loadFontFaces の ahFaceWeight と同じ登録の太さ)。
 * 可変フォント・太さの読めない書体・ファイルの無い face は、記述子の値 (無ければ 400)。鍵は小文字のファミリー名
 */
export async function faceFileWeights(css: string | ParsedCss, files: FontFile[]): Promise<Map<string, number[]>> {
  const fileOf = faceFileResolver(files);
  const out = new Map<string, number[]>();
  for (const ff of (typeof css === 'string' ? parseCss(css) : css).fontFaces) {
    const fam = ff.family.toLowerCase();
    if (!fam) continue;
    let weight = ff.weight;
    const file = ff.weightRange ? undefined : ff.srcs.map(fileOf).find(Boolean);
    if (file) {
      try {
        const st = fontFileStyle(await file.arrayBuffer());
        if (!st.variable && st.weight !== undefined) weight = st.weight;
      } catch {
        // 読めない書体は記述子の値のまま (loadFontFaces が警告に出す)
      }
    }
    out.set(fam, [...(out.get(fam) ?? []), weight]);
  }
  return out;
}

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
  /** 等幅の欧文の書体 (既定は Cousine。--generic-font monospace=… で変えられる) */
  const monoLatin = () => fonts.latinFallbackOf(MONO_STACK) ?? 'Cousine';
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
        const latin = mono ? monoLatin() : before.some((n) => GOTHIC.test(n)) ? sansLatin() : serifLatin();
        if (latin === 'Cousine') monoUsed = true;
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
      // 欧文は等幅の総称の書体 (monoLatin)。Courier・Courier New の名指しは、等幅の総称を差し替えても、字幅を合わせた Cousine
      const courier = /^courier( new)?$/i.test(known) && monoLatin() !== 'Cousine';
      const latin = courier ? 'Cousine' : monoLatin();
      if (latin === 'Cousine') monoUsed = true;
      const stack = (monoCjk === SANS ? MONO_STACK : MONO_SERIF_STACK) + (courier ? ' Courier' : '');
      fonts.defineStack(stack, monoCjk, latin, { first: true });
      return stack;
    }
    if (GOTHIC.test(first)) return SANS;
    // 明朝系・未指定の太字: 同じファミリーの太い書体で組む。和文は Noto Serif JP の太字、欧文は明朝系の欧文の書体 (既定は Tinos) の太字。
    // ゴシック (Noto Sans JP) には替えない。CSS Fonts 4 §5.2: 太さは、font-family の並びで選んだファミリーの書体の中で照合する
    // ("font-weight is matched next")。§2.2.2: 太い書体の無いファミリーの太字は、処理系が作り、そのファミリーにあるものとして扱う
    // ("bold faces are often synthesized by user agents for families that lack actual bold faces") = inlineLayout の fakeBold。
    // XSL 1.1 §7.9.9 も、太さの値を同じファミリーの書体に割り当てる (無い太さは、同じファミリーの近い太さの書体)。
    // 太字のときは、いつも明朝を名指しで返す (親がゴシックでも、明朝系の太字の指定は明朝にする)
    if (bold) return SERIF;
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
  /**
   * 登録した face (「登録の名前@太さ」) → 登録に使ったファイルと、ファイルで決まる登録のときのファイルの印。
   * 同じ割り当てで文書を続けて読む画面では、前の文書の face が残っているので、読み直すか・外すかを、これで決める (loadFontFaces)
   */
  const registeredFaces = new Map<string, { family: string; weight: number; file: FontFile; id: string | undefined }>();

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
   *
   * 戻り値の missing: src の url() のどれにも当たるファイルが無かった face (書体名と最初の src)。CSS Fonts 4 §4.3 では、読めない src は飛ばし、
   * どれも読めなければ、その face は無いものとして次の書体で組む。黙って次の書体にすると気付けないので、呼ぶ側が警告に出す。
   * http(s):・data:・//host/… の src は除く (取れなかった・取らなかった http(s) の書体は、参照を集めるところ (resources.ts) が知らせる)
   */
  async function loadFontFaces(css: string | ParsedCss, files: FontFile[], opts: { ahFaceWeight?: boolean } = {}): Promise<{ missing: Array<{ family: string; src: string }> }> {
    const missing: Array<{ family: string; src: string }> = [];
    table.clear('face');
    const fileOf = faceFileResolver(files);
    // ファミリごとの face の並び。unicode-range の違う face は、別の名前で登録し、範囲つきの書体の組にまとめる (Fonts 4 §4.5)
    const groups = new Map<string, RangedFace[]>();
    // この文書で定義した face (「書体名@太さ」) ごとの、定義に使ったファイルの並び (書いた順)
    const defined = new Map<string, FontFile[]>();
    // この文書が使う、登録した face (registeredFaces の鍵)。終わりに、ここに無い face (前の文書だけにあったもの) を外す
    const used = new Set<string>();
    for (const ff of (typeof css === 'string' ? parseCss(css) : css).fontFaces) {
      const file = ff.srcs.map(fileOf).find(Boolean);
      if (!file) {
        if (ff.srcs.length && !ff.srcs.some((s) => /^(https?:|data:|\/\/)/i.test(s))) missing.push({ family: ff.family, src: ff.srcs[0] });
        continue;
      }
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
        // 読み込み済みなら読み直さない: 同じファイル (同じ File・同じ渡されたファイルそのもの。設定を変えて同じ文書を組み直すとき) のときだけ。
        // 同じ「書体名@太さ (と傾き・幅)」でも、別のファイルなら読み直す (画面で、同じ font-family の名前で別の書体を指す文書を続けて
        // 開いたとき、前の文書の書体で組まない)。ファイルで決まるもの (後の定義・ファイルの太さで登録したもの) は、ファイルの印も同じとき
        const key = `${family}@${weight}${shapeKey}`;
        const fileId = earlier.length || sfnt ? (file.url ?? file.path ?? file.name) : undefined;
        const had = registeredFaces.get(key);
        used.add(key);
        if (!had || had.file !== file || (fileId !== undefined && had.id !== fileId)) {
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
          // 外すとき (fonts.remove) は、登録された名前 (傾き・幅を持つ書体は、印の付いた名前) で引く
          registeredFaces.set(key, { family: lf.family, weight, file, id: fileId });
        }
        const g = groups.get(ff.family) ?? [];
        const same = earlier.length ? { family: first, weight, ...(style ? { style } : {}), ...(width !== undefined ? { width } : {}) } : undefined;
        if (!g.some((x) => x.family === family && x.same?.weight === same?.weight && x.same?.style === same?.style && x.same?.width === same?.width)) g.push({ family, ...(ff.ranges ? { ranges: ff.ranges } : {}), ...(same ? { same } : {}) });
        groups.set(ff.family, g);
      } catch (e) {
        console.warn(`@font-face ${ff.family}: ${String(e)}`);
      }
    }
    // 前の文書だけにあった face を外す (画面は、書体の組と割り当てを 1 つだけ作って使い回す。前の文書の太字の face が、
    // 太字の face の無い次の文書の太字に使われないように。API は文書ごとに書体の組の写しを作るので、外すものは無い)
    for (const [key, r] of registeredFaces) {
      if (used.has(key)) continue;
      fonts.remove(r.family, r.weight);
      registeredFaces.delete(key);
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
    return { missing };
  }

  /** HTML の font-family: @font-face の書体を先に探し (和文は Noto)、無ければ XSL-FO と同じ選び方 */
  /**
   * line-height: normal: 最初に使える書体 (CSS Inline 3 §5.3 の first available font) が @font-face で読み込んだ書体なら、その書体の上下の高さと
   * 行間 (hhea) から。ほかは undefined (1.2)。並びの中で、読み込んだ書体より前に総称・既定の書体の名前があるときは、最初に使える書体は
   * 既定の書体 (htmlFontList の並びの先頭) なので undefined。後ろに並ぶ書体の字は、組まれた行でその書体の上下を数える (fontManager.ts の normalLineBounds)
   *
   * opts.defaultFonts (ブラウザの既定のスタイル。HtmlImportOptions.normalLineHeightAllFonts): 既定の書体 (Noto Serif JP・Tinos・Cousine など) が
   * 最初に使える書体のときも、その書体の hhea の ascent + descent + lineGap にする (CSS Inline 3 §5.3・§6.4: normal は最初に使える書体の値。
   * CSS 2.1 §10.8.1。Chromium と同じ)。最初に使える書体は、並びのうち空白の字 (U+0020) を持つ最初の書体 (CSS Fonts 4 §5.4 の first available font)。
   * 等幅の書体 (Cousine) は、等幅の指定が分かってから読み込む (api.ts) ので、まだ無ければ undefined (1.2。空白の字の書体は和文の書体になり、
   * その値 1.448 は、お手本の等幅の書体の値より遠い)。api.ts は、読み込んでから組み直す
   */
  function htmlNormalLineHeight(names: string[], bold: boolean, opts?: { defaultFonts?: boolean }): number | undefined {
    if (opts?.defaultFonts) {
      const fam = mapHtmlFont(names, bold);
      if (!fam || ((fam === MONO_STACK || fam === MONO_SERIF_STACK) && !fonts.has(monoLatin()))) return undefined;
      const f = fonts.getForChar(fam, bold ? 700 : 400, ' ');
      const hh = (f.fk as unknown as { hhea?: { ascent: number; descent: number; lineGap: number } }).hhea;
      return hh ? (hh.ascent - hh.descent + hh.lineGap) / f.unitsPerEm : undefined;
    }
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

  /**
   * XSL-FO の font-family の並びと、要素の言語 (xml:lang・language) から書体を決める。言語が日本語・中国語・韓国語でない要素では、
   * 既定の書体の組 (和文の書体 + 欧文の書体) を、記号と、単独のギリシャ文字・キリル文字 (ロシア語の и・в・у など) も欧文の書体で組む組に
   * する (HTML の mapHtmlFont と同じ。CSS Fonts 4 §5.2: 字に使う書体は、その字のある要素ごとに選ぶ。XSL 1.1 §7.9.2 の font-selection-strategy
   * の auto は、処理系が字ごとに書体を選ぶ)。読み込んだ書体 (MS 明朝など) を名指しした並びは、言語によらず今までどおり
   */
  function mapFoFont(names: string[], bold: boolean, lang?: string, explicit = false): string | undefined {
    const fam = mapFont(names, bold);
    // 言語の符号は 2 字 (ISO 639-1) と 3 字 (ISO 639-2。XSL 1.1 §7.10.1 の language は 3 字でもよい) の両方
    const latinDoc = !!lang && lang !== 'none' && !/^(ja|jpn|zh|zho|chi|ko|kor)\b/i.test(lang);
    // explicit: 既定の組も名指しで返す (欧文の要素の中の、和文の要素で、親の欧文の組を受け継がないように)
    if (!latinDoc) return fam ?? (explicit ? (names.some((n) => GOTHIC.test(n)) ? SANS : SERIF) : undefined);
    const base = fam ?? (names.some((n) => GOTHIC.test(n)) ? SANS : SERIF);
    if (base !== SERIF && base !== SANS) return fam;
    const latin = base === SANS ? sansLatin() : serifLatin();
    const alias = `${base}+${latin}`;
    fonts.defineStack(alias, base, latin, { symbol: latin });
    return alias;
  }

  return { mapFont, mapFoFont, mapHtmlFont, htmlNormalLineHeight, loadFontFaces, usesMono: () => monoUsed };
}
