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
