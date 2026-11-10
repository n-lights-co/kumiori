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

/**
 * PostScript の 1 つの文書 (EPS) が確保できる VM (配列・文字列・辞書など、合成オブジェクトの値を置く所。PLRM §3.7) の量の上限 (512MB。超えれば VMerror)。
 * PLRM 第 3 版の付録 B (実装の限界) は、VM の大きさを「その製品の持つメモリで決まる」ものとしている (§B.1 の末尾・表 B.1 の注)。
 * ここでは、確保のたびに積む量 (配列は 1 要素 8 バイト = §B.1 のオブジェクトの大きさ、文字列は 1 字 1 バイト、辞書は 1 項 128 バイト) の合計で数える。
 * 実在の EPS (描画ソフトの書き出した数十 MB のもの) が積む量は、ファイルの大きさの数倍 (プログラムの中の文字列・手続き) と、
 * 画像の行を読む文字列を行ごとに作り直すもので標本の総バイト数 (PS_TOTAL_IMAGE_PIXELS の 4 成分で 400MB) までなので、それを弾かない大きさにした
 */
export const PS_MAX_VM_BYTES = 512 * 1024 * 1024;

/**
 * PostScript の 1 つの文書 (EPS) が作るパスの点 (moveto・lineto・curveto・closepath の 1 つを 1 点と数える) の合計の上限 (500 万点。超えれば limitcheck)。
 * PLRM 付録 B の表 B.1 は、パスの点の数を LanguageLevel 1 で 1500、LanguageLevel 2 以降は「メモリで決まる」としている。
 * 描画の並びの 1 件 (4 点と数える) と文字 (1 字で 1 点) も同じ数に積む。1 点は 70〜90 バイトを使うので、500 万点で 450MB ほど。
 * 1 点の記述には 15 バイト以上かかるので、500 万点はパスだけで 75MB を超える EPS に当たる (数十 MB の EPS のパスの点は、多くて 200 万ほど)。
 * fill・stroke・clip が描画の並びに写す点の合計は、別に、この 2 倍までにする (Graphics.shownPoints。同じパスを塗って線も引く絵は、作った点の 2 倍を写す)
 */
export const PS_MAX_PATH_POINTS = 5_000_000;

/**
 * PostScript のフィルタが、元のデータを読みためる量の上限 (16MB。超えれば limitcheck)。
 * ReusableStreamDecode (元を全部読んでから使う。PLRM §3.13.3)・DCTDecode (JPEG を終わりまで読んでから画像にする)・予測関数の 1 行に当てる。
 * 網かけのデータの元 (psShading) の上限と同じ値
 */
export const PS_FILTER_MAX_BYTES = 16 << 20;
