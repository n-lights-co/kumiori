/**
 * imageLimits — 画像を読むときの大きさの上限。すべての復号器 (GIF・BMP・JPEG・WebP・VP8・CCITT・メタファイルの DIB・PostScript の image) が
 * ここの値を見る (ファイルの頭に書かれた寸法をそのまま信じると、小さなファイルで大量のメモリを確保するため)。
 */

/** 1 枚の画像の画素の数の上限 (1 億画素。RGBA で 400MB)。これを超える画像は読まない (描けない画像として扱う) */
export const MAX_PIXELS = 1e8;

/** PostScript の image 1 枚の画素の数の上限 (6,400 万画素。超えれば limitcheck) */
export const PS_IMAGE_MAX_PIXELS = 64_000_000;

/**
 * PostScript の 1 つの文書 (EPS) で描く画像の画素の合計の上限。DisplayItem は RGBA を持ち続けるので、
 * 文書の画像の上限 MAX_PIXELS と同じにする (RGBA で 400MB まで)
 */
export const PS_TOTAL_IMAGE_PIXELS = MAX_PIXELS;

/**
 * メタファイル (WMF・EMF) と CGM の 1 つの文書の中で、画素にする画像 (DIB・CELL ARRAY・PATTERN TABLE の模様・タイルの並び) の画素の合計の上限。
 * PS_TOTAL_IMAGE_PIXELS と同じ考え方 (1 枚ごとの上限だけでは、小さな記録を並べるだけで、いくらでも画素を作れる)。
 * これらの画像は、圧縮しない PNG を base64 にして 1 つの SVG の文字列に入れる (1 画素あたり約 5.3 字) ので、文字列の長さの上限
 * (V8 では約 5.3 億字) に収まるよう、MAX_PIXELS より小さくする。6,400 万画素 (SVG で約 3.4 億字) は、A0 判を 200dpi で走査した
 * 図面 (6,622 × 9,362 = 約 6,200 万画素) が入る値
 */
export const METAFILE_TOTAL_IMAGE_PIXELS = 64_000_000;
