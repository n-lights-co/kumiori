/**
 * text-transform (CSS・XSL-FO 共通): uppercase・lowercase・capitalize と、CSS の full-width・full-size-kana (組み合わせてよい)。
 * capitalize は、語の最初の字を大文字にする。語は、字・数字と、語の中のアポストロフィの並び
 * (「Oliver's」は 1 語。ハイフン・空白・括弧・引用符は区切り)。
 * lowerRest: capitalize で、語の残りの字を小文字にする (アンテナハウスの組み方。仕様 (CSS・XSL 1.1 §7.17.6) では残りの字は変えない)
 */
export function applyTextTransform(t: string, transform: string | undefined, opts: { lowerRest?: boolean } = {}): string {
  if (!transform) return t;
  // 値は [capitalize | uppercase | lowercase] || full-width || full-size-kana の組み合わせ (CSS Text 3 §2.1)。大文字・小文字を先に当てる
  let out = t;
  if (/uppercase/.test(transform)) out = out.toUpperCase();
  else if (/lowercase/.test(transform)) out = out.toLowerCase();
  else if (/capitalize/.test(transform)) {
    out = out.replace(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{M}\p{N}]+)*/gu, (w) => {
      const [first, ...rest] = [...w];
      return first.toUpperCase() + (opts.lowerRest ? rest.join('').toLowerCase() : rest.join(''));
    });
  }
  if (/full-width/.test(transform)) {
    // ASCII の字と空白は全角の形に、半角の片仮名 (と濁点・半濁点) は全角の片仮名にする (NFKC で 1 字にまとめる)
    out = out
      .replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
      .replace(/ /g, '\u3000')
      .replace(/[\uFF61-\uFF9F]+/g, (m) => m.normalize('NFKC'));
  }
  if (/full-size-kana/.test(transform)) out = Array.from(out, (c) => SMALL_KANA[c] ?? c).join('');
  return out;
}

/** 小書きの仮名 → 大きな仮名 (CSS Text 3 付録 G「Small Kana Mappings」の表。規範) */
const SMALL_KANA: Record<string, string> = Object.fromEntries(
  (
    [
      [0x3041, 0x3042], [0x3043, 0x3044], [0x3045, 0x3046], [0x3047, 0x3048], [0x3049, 0x304a], [0x3095, 0x304b], [0x3096, 0x3051], [0x1b132, 0x3053],
      [0x3063, 0x3064], [0x3083, 0x3084], [0x3085, 0x3086], [0x3087, 0x3088], [0x308e, 0x308f], [0x1b150, 0x3090], [0x1b151, 0x3091], [0x1b152, 0x3092],
      [0x30a1, 0x30a2], [0x30a3, 0x30a4], [0x30a5, 0x30a6], [0x30a7, 0x30a8], [0x30a9, 0x30aa], [0x30f5, 0x30ab], [0x31f0, 0x30af], [0x30f6, 0x30b1],
      [0x1b155, 0x30b3], [0x31f1, 0x30b7], [0x31f2, 0x30b9], [0x30c3, 0x30c4], [0x31f3, 0x30c8], [0x31f4, 0x30cc], [0x31f5, 0x30cf], [0x31f6, 0x30d2],
      [0x31f7, 0x30d5], [0x31f8, 0x30d8], [0x31f9, 0x30db], [0x31fa, 0x30e0], [0x30e3, 0x30e4], [0x30e5, 0x30e6], [0x30e7, 0x30e8], [0x31fb, 0x30e9],
      [0x31fc, 0x30ea], [0x31fd, 0x30eb], [0x31fe, 0x30ec], [0x31ff, 0x30ed], [0x30ee, 0x30ef], [0x1b164, 0x30f0], [0x1b165, 0x30f1], [0x1b166, 0x30f2],
      [0x1b167, 0x30f3], [0xff67, 0xff71], [0xff68, 0xff72], [0xff69, 0xff73], [0xff6a, 0xff74], [0xff6b, 0xff75], [0xff6f, 0xff82], [0xff6c, 0xff94],
      [0xff6d, 0xff95], [0xff6e, 0xff96],
    ] as Array<[number, number]>
  ).map(([a, b]) => [String.fromCodePoint(a), String.fromCodePoint(b)]),
);
