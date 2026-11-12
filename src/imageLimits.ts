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
 * メタファイル・CGM の画素の合計を、ファイルの大きさでも縛る値 (metafilePixelBudget)。
 * 連長の符号 (RLE の DIB の「画像の終わり」・ずれの符号、CELL ARRAY の連なり、タイルの「全部が背景」・T.6 の白い行) は、数バイトで
 * 何千万もの画素を指定できるので、上の合計の上限だけでは、数百バイトのファイルから上限いっぱいの画像を作れた
 * (220 バイトの EMF で、SVG が 3.4 億字、常駐のメモリが 1.7GB、1 分あまり。IMG-18)。画素は RGBA の配列と、PNG を base64 にした SVG の
 * 文字列になるので、手間とメモリは画素の数に比例する。そこで、画素にできる数を「ファイルの大きさに依らず使える分 + 1 バイトあたりの分」までにする。
 *  - METAFILE_FREE_PIXELS: ファイルの大きさに依らず使える分 (512 × 512 画素)。小さな図・模様・色の補間の画像は、どう符号化してあっても描く
 *  - METAFILE_PIXELS_PER_BYTE: ファイルの 1 バイトあたりの分 (1,024 画素)。正当な符号の密度は、圧縮しない 1 ビットの DIB が 1 バイトで 8 画素、
 *    RLE4・RLE8 の連なりが 1 バイトで 127.5 画素まで ([MS-WMF] 3.1.6: 2 バイトで 255 画素)、線画を T.6 で符号化したもの (圧縮しない 1 ビットの
 *    20〜100 分の 1) が 1 バイトで 160〜800 画素。1,024 画素は、1 ビットの画素を 128 分の 1 に縮めた密度で、PNG の圧縮 (deflate。最大で約 1,030 分の 1) が
 *    RGBA の画素に対して届く密度 (1 バイトで約 260 画素) より大きい。上限いっぱい (6,400 万画素) の画像は、約 61KB より大きなファイルなら描ける
 * この値では、数百バイトのファイルが作れる画素は 80 万画素ほど (SVG で約 400 万字) まで。値を大きくすれば、小さなファイルの使える手間が増え、
 * 小さくすれば、よく縮む正当な画像 (ほぼ白紙の走査の画像・単色の広い塗りを連なり 1 つで書いたもの) を落とすことが増える。
 * ファイルの大きさを増やせば上限いっぱいまで作れることは変わらない (上限いっぱいの手間そのものを減らすには、画素を SVG の文字列で持たない形にする必要がある)
 */
export const METAFILE_FREE_PIXELS = 512 * 512;
export const METAFILE_PIXELS_PER_BYTE = 1024;

/**
 * GIF の画素の数を、ファイルの大きさでも縛る値 (gifPixelBudget。IMG-19 (2))。GIF の頭の寸法 (論理画面と画像の幅・高さ) は 16 ビットなので、
 * 34 バイトのファイルで 10000 × 10000 画素を指定でき、画素の配列 (RGBA で 400MB) と PNG を作るのに 12 秒・2.1GB を使った。
 * GIF の画素は LZW で符号化する (GIF89a 仕様の付録 F)。符号は 12 ビットまでで、1 つの符号が表す字の並び (画素) は、符号の表の項目の数
 * (4,096) より長くならない。表がいっぱいになった後の符号は 12 ビット (1.5 バイト) なので、正当な GIF の密度は 1 バイトで約 2,730 画素が上限
 * (全体が 1 色の画像)。そこで、1 バイトあたり 4,096 画素 (その上限より大きい) と、ファイルの大きさに依らない分 (1024 × 1024 画素) までにする。
 * 10000 × 10000 画素の GIF は、約 24KB 以上でなければ読まない (正当な GIF は、1 色でも約 37KB になる)
 */
export const GIF_FREE_PIXELS = 1024 * 1024;
export const GIF_PIXELS_PER_BYTE = 4096;

/** fileBytes バイトの GIF が、画素にできる数 (論理画面と、画像の画素の数の、それぞれの上限) */
export const gifPixelBudget = (fileBytes: number): number => Math.min(MAX_PIXELS, GIF_FREE_PIXELS + GIF_PIXELS_PER_BYTE * fileBytes);

/**
 * ほかの画素の形式も、GIF と同じ考え方で、画素の数をファイル (符号のデータ) の大きさで縛る (IMG-19 (1))。
 * 画素の数の上限 = min(MAX_PIXELS, IMAGE_FREE_PIXELS + 1 バイトあたりの画素の数 × バイト数)。1 バイトあたりの画素の数は、
 * 形式ごとに、その規格の符号で 1 バイトが表せる画素の数の上限 (正当なファイルの密度の上限) より大きくとる。
 * 頭の寸法だけを大きくした数十バイトのファイルで、1 億画素 (RGBA で 400MB) の配列を作り、組むのに 10〜19 秒・2〜2.6GB を使っていた
 */
export const IMAGE_FREE_PIXELS = GIF_FREE_PIXELS;

/** fileBytes バイトのデータが、1 バイトあたり perByte 画素の形式で、画素にできる数 */
export const pixelBudget = (fileBytes: number, perByte: number): number => Math.min(MAX_PIXELS, IMAGE_FREE_PIXELS + perByte * fileBytes);

/**
 * VP8 (WebP の非可逆) の 1 バイトあたりの画素の数 (VP8 のチャンクの大きさに当てる)。キーフレームのマクロブロック (16 × 16 画素) は、
 * どれも、輝度の予測の向き (RFC 6386 §11.2。最初の判定の確率は 145/256 で固定) と、色差の予測の向き (§11.4。最初の判定の確率は 142/256 で固定) を
 * 最初の区画にブール符号 (§7) で持つ。確率の固定された判定は、ブール符号でも −log2(確率) ビットより短くならないので、マクロブロックは
 * 最も起きやすい向きを選んでも 0.820 + 0.850 = 1.67 ビット以上を使う (4×4 の向き・係数・飛ばしの印は数えない)。
 * よって、正当な VP8 の密度は 1 バイトで 256 × 8 / 1.67 = 約 1,226 画素まで。その上の 2,048 画素にする
 */
export const VP8_PIXELS_PER_BYTE = 2048;

/**
 * VP8L (WebP の可逆) の 1 バイトあたりの画素の数 (VP8L のチャンクの大きさに当てる)。RFC 9649 §3.7.2.1.1 の簡単な符号で字が 1 つだけの符号は
 * 0 ビットで読むので、全部が 1 色の画像 (と、色のキャッシュの同じ番号だけの画像) は、どれだけ大きくても数十バイトで書ける。
 * 規格には密度の上限が無いので、そうでない画像の密度の上限から決める: 緑の符号が 2 字以上なら、画素 (か後方参照) ごとに 1 ビット以上を使い、
 * 後方参照の長さ L は前置きの符号のほかに、L が 2^(e+2) までなら e ビットの追加のビットを使う (§4.2.2。4,096 画素は 10 ビット)。
 * よって 1 ビットあたり 4,096 / 11 = 約 372 画素、色の表の変換で 8 画素を 1 つに詰めても (§4.4)、1 バイトで約 23,800 画素まで。その上の 32,768 画素にする。
 * **全部 (または大半) が 0 ビットの符号の、ほぼ 1 色の大きな可逆の WebP は、この上限を超えれば読まない** (仮の枠で描いて警告を出す。
 * 1 億画素は約 3KB 以上の VP8L で読める)。動く WebP の canvas (VP8X の大きさ) も、ファイルの大きさでこの上限に縛る
 */
export const VP8L_PIXELS_PER_BYTE = 32768;

/**
 * JPEG の 1 バイトあたりの画素の数 (ファイルの大きさに当てる)。ハフマン符号の長さは 1 ビット以上 (T.81 B.2.4.2 の BITS は長さ 1〜16 の符号の数) で、
 * 逐次の符号 (F.1.2.1) も漸進の DC の最初の走査 (G.1.2.1) も、どの成分のどの 8 × 8 の区画にも DC の差の符号を 1 つ持つので、区画ごとに 1 ビット以上を使う。
 * 濃淡の画像は 1 ビットで 64 画素、3 成分で標本化の比が最も偏った組 (4×1・1×4・1×1。各成分の区画は合わせて画像の 64 × 16 画素あたり 9 個) でも
 * 1 ビットで 64 × 16 / 9 = 約 114 画素なので、正当な JPEG の密度は 1 バイトで約 910 画素まで。その上の 1,024 画素にする
 * (データの途中で切れた JPEG は、切れた所の後を 0 の係数にして描くが、この上限を超えるほど短ければ読まない)
 */
export const JPEG_PIXELS_PER_BYTE = 1024;

/**
 * CCITT (TIFF の Compression=2・3・4) の 1 バイトあたりの画素の数 (そのストリップ・タイルのデータの大きさに当てる)。
 *  - 1 次元の符号 (Modified Huffman。T.4 §4.1): 連なりの長さの符号は、最も密なもので 2,560 画素を 12 ビットで書く (追加の Make-up の符号) ので、
 *    1 バイトで約 1,707 画素まで。その上の 2,048 画素にする (CCITT_1D_PIXELS_PER_BYTE)
 *  - 2 次元の符号 (T.4 §4.2・T.6): 行は 1 つ以上のモードの符号で書き、最も短い符号 (V0) は 1 ビット (T.4 の Table 4/T.4) なので、行の数は
 *    データのビット数まで (ccittRowLimit)。全部白の行は幅に依らず 1 ビットで書けるので、規格からは幅あたりの密度の上限が決まらない。
 *    そこで、幅 16,384 画素 (A3 の長辺を 1,000dpi ほど) までの白紙を通す値 (1 バイトの 8 行 × 16,384 画素 = 131,072 画素) にする
 *    (CCITT_2D_PIXELS_PER_BYTE。A4 を 600dpi で走査した白紙の T.6 (4,960 × 7,016 画素・約 880 バイト) も通る)。
 *    **幅が 16,384 画素より広く、ほとんど白紙の CCITT の画像は、この上限を超えれば読まない**
 */
export const CCITT_1D_PIXELS_PER_BYTE = 2048;
export const CCITT_2D_PIXELS_PER_BYTE = 131072;
/** 2 次元の CCITT の符号の、dataBytes バイトのデータが持てる行の数の上限 (1 行は 1 ビット以上。T.4 の Table 4/T.4 の V0) */
export const ccittRowLimit = (dataBytes: number): number => dataBytes * 8;

/**
 * RLE4・RLE8 の BMP の 1 バイトあたりの画素の数 (ファイルの大きさに当てる)。メタファイルの中の RLE の DIB と同じ値 (METAFILE_PIXELS_PER_BYTE):
 * 符号化の形の連なりは 2 バイトで 255 画素まで ([MS-WMF] 3.1.6) だが、「行の終わり」「画像の終わり」「ずれ」の符号は、数バイトで
 * いくらでも多くの画素を指定せずに飛ばせるので、規格からは上限が決まらない。ほぼ白紙の大きな RLE の BMP は、この上限を超えれば読まない
 */
export const BMP_RLE_PIXELS_PER_BYTE = METAFILE_PIXELS_PER_BYTE;

/**
 * deflate (zlib) の展開の比の上限 (RFC 1951 §3.2.5: 長さの符号の表す長さは 258 バイトまで。長さ・字の符号と距離の符号は、
 * 字が 2 つ以上なら 1 ビット以上で、距離の符号が 1 つだけでも 1 ビットで書く (§3.2.7) ので、1 ビットで 129 バイト、1 バイトで 1,032 バイトまで)。
 * 正当な deflate のデータは、これより大きく膨らまない。PNG の IDAT (pngWithinLimits) と WOFF の表 (webFont.ts) に当てる
 */
export const DEFLATE_MAX_RATIO = 1032;

/**
 * WOFF・WOFF2 を戻した書体 (sfnt) の大きさの上限 (webFont.ts)。
 *  - 合計は WEBFONT_MAX_SFNT_BYTES (128MB) まで: ネットワークから取る書体の上限 (fetchLimits.fontBytes) と同じ。それより大きな書体を
 *    WOFF に包んでも読まない。WOFF の表の目録の origLength (WOFF 1.0 §5) と WOFF2 の目録の origLength・transformLength (WOFF2 §4.1) は
 *    32 ビットで、それぞれ 4GB まで書けるので、頭の値のとおりに展開すると、小さなファイルで数 GB を使う
 *    (300KB の WOFF で 5.6 秒・2GB、558 バイトの WOFF2 で 3.3 秒・1.7GB)
 *  - ファイルの大きさの WEBFONT_MAX_RATIO 倍 + WEBFONT_FREE_BYTES まで: Brotli (RFC 7932) の展開の比には実用の上限が無い (1 つの命令で 1,600 万バイト
 *    を写せる) ので、実在の書体の圧縮の比から決める。実在の WOFF2 の比は多くて 20 倍ほどで、Google の woff2 の復号器も、100 倍を超えるものを
 *    ありえないものとして断る。WOFF 1.0 の表ごとの比は、別に deflate の上限 (DEFLATE_MAX_RATIO) でも縛る
 */
export const WEBFONT_MAX_SFNT_BYTES = 128 * 1024 * 1024;
export const WEBFONT_MAX_RATIO = 100;
export const WEBFONT_FREE_BYTES = 1024 * 1024;
/** fileBytes バイトの WOFF・WOFF2 を戻した書体の大きさの上限 */
export const webFontSfntBudget = (fileBytes: number): number => Math.min(WEBFONT_MAX_SFNT_BYTES, WEBFONT_FREE_BYTES + WEBFONT_MAX_RATIO * fileBytes);

/** fileBytes バイトのメタファイル・CGM が、画素にできる数 (その文書の画像の画素の合計の上限) */
export const metafilePixelBudget = (fileBytes: number): number => Math.min(METAFILE_TOTAL_IMAGE_PIXELS, METAFILE_FREE_PIXELS + METAFILE_PIXELS_PER_BYTE * fileBytes);

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

/**
 * PostScript の 1 つの文書 (EPS) が使うメモリの合計の上限 (512MB。超えれば VMerror)。PLRM 第 3 版の付録 B の冒頭は、限界を超える操作は
 * limitcheck、仮想メモリを使い切る操作は VMerror になるとし、§B.1 は、VM・スタック・パスなどが処理系のメモリを分け合い、
 * LanguageLevel 2 以降では用途の間で融通されるとしている。上の VM・パスの点・画像の画素の上限は、それぞれは効くが互いに独立なので、
 * 合わせるとメモリを 1.4GB 以上使えた (PS-18)。そこで、確保のたびに、この処理系が実際に使う量に近いバイト数を 1 つの勘定に積む
 * (Interp.memAlloc。重みは psInterp.ts の MEM_*・psGraphics.ts の MEM_PATH_POINT):
 *  - VM: 文字列は長さ + 256 バイト、配列は 1 要素 88 バイト、辞書は 1 項 192 バイト、save の後の書き換えの控えは 1 件 160 バイト
 *    (VM の勘定は配列の 1 要素を 8 バイトと数えるので、別々の整数を詰めた配列を作り続けるプログラムは、VM の上限 512MB に届く前、
 *    時間の上限の 20 秒までに、ヒープを 2GB 使った)
 *  - パスの点・描画の並び: 1 点 96 バイト、描画の並びに写した点は 1 点 8 バイト
 *  - 画像・網かけ: 1 画素 4 バイト (RGBA)。JPEG のまま持つ画像は、読みためた JPEG の分 (VM に積んである) だけ
 * 512MB にした根拠 (Node 22 で測った):
 *  - 弾かないもの: 画像は、文書の画素の合計の上限 (PS_TOTAL_IMAGE_PIXELS = 1 億画素) まで読めて 400MB で、残りの 112MB が
 *    プログラム (数十 MB の EPS の文字列・手続き・パス) に使える。1 行ごとに文字列を作り直して画像を読む EPS は、標本の分も積むので、
 *    CMYK で 6,400 万画素 (8000 × 8000) まで。描画ソフトの書き出したパスだけの EPS は、数十 MB (点が 200 万ほど) で約 200MB
 *  - 落とさないこと: 上限いっぱいまで使うプログラムのヒープは、別々の実数の配列で 380MB、辞書で 450MB、曲線のパスで 480MB。
 *    画像と文字列はヒープの外で、上限まで (512MB)。画像・パス・描画の並び・配列・文字列を順にいっぱいまで使うプログラムは、
 *    この上限の前は常駐のメモリを 1.9GB 使い、ヒープの上限が 1GB (--max-old-space-size=1024) で落ちた。今は 650MB で、落ちない。
 *    ヒープの上限が 512MB でも、実行だけなら落ちなかったが、SVG にする所 (epsToSvg。PS_MAX_SVG_CHARS) で落ちることがある。
 *    ヒープの小さな環境では、EpsLimits の maxMemory と maxSvgChars を下げる
 */
export const PS_MAX_MEMORY_BYTES = 512 * 1024 * 1024;

/**
 * EPS を SVG にした文字列 (eps.ts の epsToSvg の出力) の長さの上限 (128MB = 1 億 3,421 万字。超えたら、そこまでを SVG にして、エラーを付けて返す)。
 * メモリの合計の上限 (PS_MAX_MEMORY_BYTES) の中でも、SVG は大きくなりうる: 描画の並びに写したパスの点 (1,000 万点まで) は 1 点が
 * 最大 30 字ほどで 300MB、入れ子のクリップは、描くものごとにクリップの g を開き直すので、35 万件の絵で SVG の断片がヒープ (2GB) を使い切った。
 * SVG を作る間は、描画の並び (メモリの合計の上限まで) のほかに、SVG の文字が 2 重 (断片と、つないだ文字列) にヒープに載る。
 * 受け取る側 (assets.ts) も、SVG の文字列を UTF-8 のバイト列に写し、XML として読んで図形にするので、文字列の何倍ものメモリを使う
 * (受け取る側には、SVG の長さの上限は無い。ファイルとして渡す SVG は 256MB まで受け付ける)。
 * 128MB なら、上限いっぱいの絵を SVG にしても、ヒープの上限が 1GB で落ちなかった (Node 22 で測った)。
 * 描画ソフトの書き出した数十 MB の EPS の SVG は、パスの記述がほぼ同じ長さなので届かない。画像は PNG の base64 になるので、
 * PNG で 96MB (写真なら 3,000〜4,000 万画素ほどが目安。A3 判の 400dpi が 3,100 万画素) までの画像が入る。JPEG のままの画像は 16MB (PS_FILTER_MAX_BYTES) まで
 */
export const PS_MAX_SVG_CHARS = 128 * 1024 * 1024;

/**
 * ネットワークから取る資源 (文書が http(s) の URL で参照する CSS・書体・画像) の、1 件の大きさの上限 (バイト) と、転送 (redirect) をたどる回数の上限。
 * 取得 (resources.ts の fetchGuarded) がここの値を見る。値を書き換えられる入れ物にしてあるのは、テストが小さな値で試すため (利用者向けの設定ではない)。
 *  - cssBytes: 16MB。実在の大きな CSS (CSS の枠組みをまとめたもの・書体を data URI で埋め込んだもの) は数 MB なので、それを弾かない
 *  - fontBytes: 128MB。和文・CJK の書体は 1 書体で 5〜25MB、いくつもの書体をまとめた集まり (TTC・OTC。CJK の全ウェイトを入れたもの) は
 *    数十 MB から 100MB ほどなので、それを弾かない
 *  - imageBytes: 256MB。ファイルとして渡した画像の上限 (assets.ts の MAX_FILE_BYTES) と同じ
 *  - redirects: 20。ブラウザが転送をたどる回数の上限 (Fetch Standard §4.5 HTTP-redirect fetch の redirect count。Node の fetch も同じ 20)
 */
export const fetchLimits = {
  cssBytes: 16 * 1024 * 1024,
  fontBytes: 128 * 1024 * 1024,
  imageBytes: 256 * 1024 * 1024,
  redirects: 20,
};

/**
 * EPUB (zip) の 1 つの項目の、展開した後の大きさの上限 (256MB。超えた項目は読めないものとして扱う)。
 * zip の中央ディレクトリに書かれた大きさは信じず、展開しながら数える (小さな deflate のデータが、約 1000 倍に膨らむ)。
 * 実在の EPUB の項目で大きいのは画像 (高解像度の見開きで数十 MB) と書体 (和文の書体で 20MB ほど) なので、それを弾かない大きさにした。
 * 256MB は、MAX_PIXELS の画像を RGB で持つ量 (300MB) に近い
 */
export const EPUB_MAX_ENTRY_BYTES = 256 * 1024 * 1024;

/**
 * 1 つの EPUB から展開する量の合計の上限 (1GB。超えたら、その EPUB は読まない)。同じ項目を何度も展開すれば、その回数だけ数える
 * (spine に同じ章を何度も書いた EPUB)。画像の多い本 (漫画・写真集) は展開して数百 MB なので、それを弾かない大きさにした。
 * 章の文字と画像は読み終わるまでメモリに置くので、PS_MAX_VM_BYTES (512MB) と同じ桁にとどめる
 */
export const EPUB_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

/**
 * 1 つの EPUB の項目の数 (zip の項目・spine の章の並び) の上限。zip の中央ディレクトリの終わりの記録は項目の数を 16 ビットで持つ
 * (ZIP64 は読まない) ので、zip の項目はもともと 65,535 まで。spine に同じ章を何度でも並べられるので、章の並びにも同じ上限を当てる
 */
export const EPUB_MAX_ENTRIES = 65_535;

/**
 * メタファイル (WMF・EMF) と CGM を SVG にした文字列の長さの上限 (画像の data: の中身は除く。そちらは画素の合計の上限 metafilePixelBudget で縛る)。
 * PS_MAX_SVG_CHARS と同じ考え方: SVG を受け取る側 (assets.ts・svg.ts) は、文字列を XML として読んで図形にするので、1 字あたり約 1 マイクロ秒と、
 * 文字列の何倍ものメモリを使う。小さな記録が、前に定義した大きなものを何度も書かせる入力では、SVG がファイルの 2 乗や数百倍に膨らんだ:
 *  - WMF の META_PAINTREGION (8 バイト) が、矩形の多い Region の全部の矩形を、塗るたびに path に書く (20KB の WMF で SVG が 9,700 万字・72 秒・2.4GB)
 *  - EMF の切り抜きの領域を、切り抜きが変わるたびに clipPath に書く (66KB で 2,900 万字)、EMR_GRADIENTFILL の三角形 (12 バイト) が 64 個の path になる (48KB で 3,100 万字)
 *  - CGM の COPY SEGMENT (24 バイト) が、点の多いセグメントを写すたびに全部書く (33KB で 18 秒・1.2GB)
 * そこで、SVG の長さを「ファイルの大きさに依らず使える分 + 1 バイトあたりの分」と、絶対の上限までにする (超えたら、そこまでを描いて警告を出す)。
 *  - METAFILE_SVG_FREE_CHARS: ファイルの大きさに依らず使える分 (2MB)。小さなファイルの模様・色の変わる塗り (三角形 1 つが 64 個の path) を弾かない
 *  - METAFILE_SVG_CHARS_PER_BYTE: 1 バイトあたりの分 (128 字)。実在のファイルの比は、WMF・EMF で 1〜2 字、2 進の CGM で 20 字ほど
 *    (docs/conformance の見本 woven.wmf 1.8・woven.emf 1.2・woven.cgm 19.0)。記録ごとの比が最も大きい普通の記録は、1 字ずつ送り幅を付けた文字
 *    (WMF の META_EXTTEXTOUT: 1 字が字 1 バイト + 送り幅 2 バイトで、回転の付いた <text> が約 200 字 = 1 バイトで約 67 字) と、
 *    CGM の短い線の要素 (10 バイトほどで、線の属性の付いた path が約 150〜250 字 = 1 バイトで約 25 字) なので、その 2 倍ほどにした
 *  - METAFILE_MAX_SVG_CHARS: 絶対の上限。EPS と同じ (PS_MAX_SVG_CHARS)。画像 (画素の合計の上限 6,400 万画素で約 3.4 億字) と合わせても、
 *    V8 の文字列の長さの上限 (約 5.3 億字) に収まる
 */
export const METAFILE_SVG_FREE_CHARS = 2 * 1024 * 1024;
export const METAFILE_SVG_CHARS_PER_BYTE = 128;
export const METAFILE_MAX_SVG_CHARS = PS_MAX_SVG_CHARS;
/** fileBytes バイトのメタファイル・CGM を SVG にした文字列 (画像の中身を除く) の長さの上限 */
export const metafileSvgBudget = (fileBytes: number): number => Math.min(METAFILE_MAX_SVG_CHARS, METAFILE_SVG_FREE_CHARS + METAFILE_SVG_CHARS_PER_BYTE * fileBytes);

/**
 * メタファイル (WMF・EMF) の 1 つの文書で、切り抜きの領域の演算 (metafile.ts の regionOp) に使える手間の合計の上限。
 * 手間は、領域を横の帯に分けたときの「帯ごとの、その帯にかかる矩形の数 + 1」の合計 (1 単位は約 0.1 マイクロ秒)。
 * 矩形の多い領域を切り抜きにして、全体を覆う矩形との演算 (META_INTERSECTCLIPRECT は 14 バイト) を繰り返すと、記録 1 つごとに領域の全部の矩形を
 * たどるので、手間はファイルの大きさの 2 乗になる (50KB の WMF で 120 秒を超えた。帯ごとに全部の矩形を調べていた頃)。
 * 5,000 万は、矩形 5,000 個の領域 (印刷のドライバーの書き出す込み入った切り抜きの大きさ) との演算を 5,000 回できる値。超えたら、その後の演算はせず
 * (切り抜きを変えず)、警告を出す
 */
export const METAFILE_REGION_WORK = 50_000_000;

/**
 * メタファイル (EMF) の 1 つの文書で、パスを含む切り抜きの OR・XOR (metafile.ts の combineClip。regionBool.ts の polyBool で多角形を演算する) に
 * 渡せる点の数の合計の上限 (1 点は約 2 マイクロ秒)。OR・XOR の結果は、それまでの全部の形を持つ 1 つの層になるので、小さなパスを
 * EMR_SELECTCLIPPATH で OR に足す記録を並べると、点の数の合計がファイルの大きさの 2 乗になる (1,000 回・52KB の EMF で 4 秒、2,000 回・104KB で 18 秒)。
 * 100 万点 (約 2 秒) は、点が 10 万の込み入った切り抜きのパス (地図・字の輪郭) との演算を 10 回できる値。超えたら、その後の演算はせず (切り抜きを変えず)、警告を出す
 */
export const METAFILE_CLIP_PATH_WORK = 1_000_000;
