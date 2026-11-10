/**
 * fontVariation — 可変フォントの軸の値の指定を、書体の名前に付ける印として持ち回る (スタイルの解決 lnode.ts → 書体の選択 fontManager.ts → 組版の結果)。
 * 書体は「名前と太さ」で引くので、太さ以外の軸の値 (幅・傾き・光学サイズ・font-variation-settings) は、名前の後ろの印で渡す。
 */

/**
 * 書体の名前に付ける、軸の値の指定 (CSS の font-width・font-style・font-optical-sizing・font-variation-settings から)。
 * 太さ (font-weight) は、書体を引くときの weight で渡すので、ここには無い
 */
export interface VariationRequest {
  /** font-width (font-stretch) の百分率 */
  wdth?: number;
  /** font-style: oblique の角度 (度。CSS の向き = 時計回りが正) */
  slnt?: number;
  /** font-style: italic */
  ital?: boolean;
  /** font-optical-sizing: auto のときの字の大きさ (pt) */
  opsz?: number;
  /** font-variation-settings (札 → 値) */
  settings?: Record<string, number>;
}

/** 軸の値の書き方 (小数 4 桁まで。末尾の 0 は書かない) */
export const variationNumber = (v: number) => String(+v.toFixed(4));
const num = variationNumber;

/**
 * 軸の値の指定を、書体の名前の後ろに付ける印にする: `{wdth=75,slnt=14,opsz=10.5;GRAD=88}` (; の前が性質から決まる値、後が font-variation-settings)。
 * 指定が無ければ空文字列。組版の結果 (GlyphArea.fontFamily) にも、この形で残る
 */
export function variationSuffix(r: VariationRequest): string {
  const hi: string[] = [];
  if (r.wdth !== undefined && r.wdth !== 100) hi.push(`wdth=${num(r.wdth)}`);
  if (r.ital) hi.push('ital=1');
  else if (r.slnt !== undefined) hi.push(`slnt=${num(r.slnt)}`);
  if (r.opsz !== undefined) hi.push(`opsz=${num(r.opsz)}`);
  const lo = Object.entries(r.settings ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${num(v)}`);
  if (!hi.length && !lo.length) return '';
  return `{${hi.join(',')}${lo.length ? `;${lo.join(',')}` : ''}}`;
}

const SUFFIX = /\{((?:[a-z]{4}=-?[\d.]+,?)*)(?:;((?:[ -~]{4}=-?[\d.]+,?)+))?\}$/;
const suffixMemo = new Map<string, [string, VariationRequest | undefined, string]>();

/** 書体の名前を、名前と軸の値の指定 (variationSuffix の印) に分ける。戻り値: [印を外した名前, 指定 (無ければ undefined), 印] */
export function splitVariation(family: string): [string, VariationRequest | undefined, string] {
  if (family.charCodeAt(family.length - 1) !== 125 /* } */) return [family, undefined, ''];
  let hit = suffixMemo.get(family);
  if (!hit) {
    const m = SUFFIX.exec(family);
    if (!m || (!m[1] && !m[2])) hit = [family, undefined, ''];
    else {
      const r: VariationRequest = {};
      for (const kv of m[1] ? m[1].split(',') : []) {
        const v = parseFloat(kv.slice(5));
        const k = kv.slice(0, 4);
        if (k === 'wdth') r.wdth = v;
        else if (k === 'slnt') r.slnt = v;
        else if (k === 'ital') r.ital = true;
        else if (k === 'opsz') r.opsz = v;
      }
      if (m[2]) {
        r.settings = {};
        // 札は 4 字 (空白・= を含みうる) なので、位置で切る
        let rest = m[2];
        while (rest.length >= 6) {
          const tag = rest.slice(0, 4);
          const end = rest.indexOf(',', 5);
          r.settings[tag] = parseFloat(rest.slice(5, end < 0 ? undefined : end));
          rest = end < 0 ? '' : rest.slice(end + 1);
        }
      }
      hit = [family.slice(0, m.index), r, m[0]];
    }
    if (suffixMemo.size > 5000) suffixMemo.clear();
    suffixMemo.set(family, hit);
  }
  return hit;
}

/** 書体の名前に、軸の値の指定の印を付ける (既に付いている印は外してから。指定が無ければ名前のまま) */
export function withVariation(family: string, r: VariationRequest): string {
  return splitVariation(family)[0] + variationSuffix(r);
}

/**
 * CSS の font-variation-settings の値 (`normal | [ <opentype-tag> <number> ]#`。CSS Fonts 4 §8.2) を読む。
 * 札は、引用符で囲んだ 4 字 (U+20〜7E)。同じ札が重なれば後のもの。normal は空。書き方が正しくなければ undefined (宣言ごと無効)
 */
export function parseVariationSettings(value: string): Record<string, number> | undefined {
  const v = value.trim();
  if (/^normal$/i.test(v)) return {};
  const out: Record<string, number> = {};
  for (const item of v.split(',')) {
    const m = /^\s*(?:"([ -~]{4})"|'([ -~]{4})')\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*$/i.exec(item);
    if (!m) return undefined;
    out[m[1] ?? m[2]] = parseFloat(m[3]);
  }
  return out;
}

/** font-width (font-stretch) の語 → 百分率 (CSS Fonts 4 §2.4 の表) */
export const FONT_WIDTH_KEYWORDS: Readonly<Record<string, number>> = {
  'ultra-condensed': 50,
  'extra-condensed': 62.5,
  condensed: 75,
  'semi-condensed': 87.5,
  normal: 100,
  'semi-expanded': 112.5,
  expanded: 125,
  'extra-expanded': 150,
  'ultra-expanded': 200,
};

/**
 * 字の大きさだけを変えたスタイルの、書体の名前 (スタイルを解決し直さずに、ルビ・注の合印などを小さく組むとき)。
 * 名前の印に光学サイズ (opsz) の指定があれば、新しい字の大きさ (pt) に替える。無ければ名前のまま
 */
export function withOpticalSize(family: string, fontSize: number): string {
  if (family.charCodeAt(family.length - 1) !== 125) return family;
  const [plain, req] = splitVariation(family);
  return req?.opsz === undefined ? family : plain + variationSuffix({ ...req, opsz: fontSize });
}
