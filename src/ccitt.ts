/**
 * ccitt — TIFF の CCITT の符号 (Modified Huffman・T.4 の 1 次元と 2 次元・T.6) を展開する。
 *
 * 根拠: TIFF 6.0 Specification (Adobe, 1992-06-03) の Section 10 (Compression=2)・Section 11 (Compression=3 の T4Options、
 * Compression=4 の T6Options) と、ITU-T Recommendation T.4 (07/96) の 4.1 (1 次元の符号)・4.2 (2 次元の符号)。
 * 1 次元の符号表は TIFF 6.0 の Section 10 の Table 1/T.4・Table 2/T.4・Additional make-up codes をそのまま写したもの
 * (T.4 (07/96) の Table 2/T.4・Table 3/T.4 と同じことを確かめた)。2 次元の符号は T.4 の Table 4/T.4。
 *  - Compression=2: 行は白の連なりから始まり、白と黒の連なりが交互に続く。行はバイトの境目から始まる。EOL は使わない。
 *  - Compression=3: 行の前に EOL (000000000001) と、その前の埋めの 0 があってよい。行はバイトの境目にそろえない。
 *    T4Options の bit 0 が 1 (2 次元の符号) なら、EOL の後の 1 ビットが次の行の符号 (1 = 1 次元、0 = 2 次元) を示す。
 *  - 非圧縮の形 (T4Options・T6Options の bit 1): T.4 の Table 5/T.4 と Table 4/T.4 の Note 2 (拡張 0000001xxx の xxx = 111)。
 *  - Compression=4: すべての行が 2 次元の符号で、最初の行の参照行は全部白 (TIFF 6.0 Section 11 の T6Options の説明)。
 *  - 連なりの長さは、0 個以上の Make-up の符号と、1 つの Terminating の符号の和。
 *  - FillOrder=1 は各バイトの上位のビットから、2 は下位のビットから読む。
 */
import { CCITT_1D_PIXELS_PER_BYTE, CCITT_2D_PIXELS_PER_BYTE, ccittRowLimit, pixelBudget } from './imageLimits';

/** 白の Terminating (0〜63) と Make-up (64〜1728) の符号 */
const WHITE: Array<[number, string]> = [
  [0, '00110101'],
  [1, '000111'],
  [2, '0111'],
  [3, '1000'],
  [4, '1011'],
  [5, '1100'],
  [6, '1110'],
  [7, '1111'],
  [8, '10011'],
  [9, '10100'],
  [10, '00111'],
  [11, '01000'],
  [12, '001000'],
  [13, '000011'],
  [14, '110100'],
  [15, '110101'],
  [16, '101010'],
  [17, '101011'],
  [18, '0100111'],
  [19, '0001100'],
  [20, '0001000'],
  [21, '0010111'],
  [22, '0000011'],
  [23, '0000100'],
  [24, '0101000'],
  [25, '0101011'],
  [26, '0010011'],
  [27, '0100100'],
  [28, '0011000'],
  [29, '00000010'],
  [30, '00000011'],
  [31, '00011010'],
  [32, '00011011'],
  [33, '00010010'],
  [34, '00010011'],
  [35, '00010100'],
  [36, '00010101'],
  [37, '00010110'],
  [38, '00010111'],
  [39, '00101000'],
  [40, '00101001'],
  [41, '00101010'],
  [42, '00101011'],
  [43, '00101100'],
  [44, '00101101'],
  [45, '00000100'],
  [46, '00000101'],
  [47, '00001010'],
  [48, '00001011'],
  [49, '01010010'],
  [50, '01010011'],
  [51, '01010100'],
  [52, '01010101'],
  [53, '00100100'],
  [54, '00100101'],
  [55, '01011000'],
  [56, '01011001'],
  [57, '01011010'],
  [58, '01011011'],
  [59, '01001010'],
  [60, '01001011'],
  [61, '00110010'],
  [62, '00110011'],
  [63, '00110100'],
  [64, '11011'],
  [128, '10010'],
  [192, '010111'],
  [256, '0110111'],
  [320, '00110110'],
  [384, '00110111'],
  [448, '01100100'],
  [512, '01100101'],
  [576, '01101000'],
  [640, '01100111'],
  [704, '011001100'],
  [768, '011001101'],
  [832, '011010010'],
  [896, '011010011'],
  [960, '011010100'],
  [1024, '011010101'],
  [1088, '011010110'],
  [1152, '011010111'],
  [1216, '011011000'],
  [1280, '011011001'],
  [1344, '011011010'],
  [1408, '011011011'],
  [1472, '010011000'],
  [1536, '010011001'],
  [1600, '010011010'],
  [1664, '011000'],
  [1728, '010011011'],
];
/** 黒の Terminating (0〜63) と Make-up (64〜1728) の符号 */
const BLACK: Array<[number, string]> = [
  [0, '0000110111'],
  [1, '010'],
  [2, '11'],
  [3, '10'],
  [4, '011'],
  [5, '0011'],
  [6, '0010'],
  [7, '00011'],
  [8, '000101'],
  [9, '000100'],
  [10, '0000100'],
  [11, '0000101'],
  [12, '0000111'],
  [13, '00000100'],
  [14, '00000111'],
  [15, '000011000'],
  [16, '0000010111'],
  [17, '0000011000'],
  [18, '0000001000'],
  [19, '00001100111'],
  [20, '00001101000'],
  [21, '00001101100'],
  [22, '00000110111'],
  [23, '00000101000'],
  [24, '00000010111'],
  [25, '00000011000'],
  [26, '000011001010'],
  [27, '000011001011'],
  [28, '000011001100'],
  [29, '000011001101'],
  [30, '000001101000'],
  [31, '000001101001'],
  [32, '000001101010'],
  [33, '000001101011'],
  [34, '000011010010'],
  [35, '000011010011'],
  [36, '000011010100'],
  [37, '000011010101'],
  [38, '000011010110'],
  [39, '000011010111'],
  [40, '000001101100'],
  [41, '000001101101'],
  [42, '000011011010'],
  [43, '000011011011'],
  [44, '000001010100'],
  [45, '000001010101'],
  [46, '000001010110'],
  [47, '000001010111'],
  [48, '000001100100'],
  [49, '000001100101'],
  [50, '000001010010'],
  [51, '000001010011'],
  [52, '000000100100'],
  [53, '000000110111'],
  [54, '000000111000'],
  [55, '000000100111'],
  [56, '000000101000'],
  [57, '000001011000'],
  [58, '000001011001'],
  [59, '000000101011'],
  [60, '000000101100'],
  [61, '000001011010'],
  [62, '000001100110'],
  [63, '000001100111'],
  [64, '0000001111'],
  [128, '000011001000'],
  [192, '000011001001'],
  [256, '000001011011'],
  [320, '000000110011'],
  [384, '000000110100'],
  [448, '000000110101'],
  [512, '0000001101100'],
  [576, '0000001101101'],
  [640, '0000001001010'],
  [704, '0000001001011'],
  [768, '0000001001100'],
  [832, '0000001001101'],
  [896, '0000001110010'],
  [960, '0000001110011'],
  [1024, '0000001110100'],
  [1088, '0000001110101'],
  [1152, '0000001110110'],
  [1216, '0000001110111'],
  [1280, '0000001010010'],
  [1344, '0000001010011'],
  [1408, '0000001010100'],
  [1472, '0000001010101'],
  [1536, '0000001011010'],
  [1600, '0000001011011'],
  [1664, '0000001100100'],
  [1728, '0000001100101'],
];
/** 白・黒に共通の Make-up の符号 (1792〜2560) */
const COMMON: Array<[number, string]> = [
  [1792, '00000001000'],
  [1856, '00000001100'],
  [1920, '00000001101'],
  [1984, '000000010010'],
  [2048, '000000010011'],
  [2112, '000000010100'],
  [2176, '000000010101'],
  [2240, '000000010110'],
  [2304, '000000010111'],
  [2368, '000000011100'],
  [2432, '000000011101'],
  [2496, '000000011110'],
  [2560, '000000011111'],
];

type Table = Map<number, number>;
/** 符号の長さと値を 1 つの鍵にした表 */
const key = (len: number, v: number) => (len << 16) | v;
function build(list: Array<[number, string]>): Table {
  const m: Table = new Map();
  for (const [run, code] of [...list, ...COMMON]) m.set(key(code.length, parseInt(code, 2)), run);
  return m;
}
let tables: { white: Table; black: Table } | undefined;
const MAX_CODE = 13;

/**
 * 2 次元の符号 (T.4 4.2.1.3.2、Table 4/T.4)。P = パス、H = 水平、V(d) = 垂直 (a1 が b1 から右へ d)。
 * 拡張 (0000001xxx) のうち非圧縮の形 (xxx = 111) は line2d で読む。ほかの拡張は定められていない (Table 4/T.4 の Note 3)
 */
const MODES: Array<[string, 'P' | 'H' | number]> = [
  ['0001', 'P'],
  ['001', 'H'],
  ['1', 0],
  ['011', 1],
  ['000011', 2],
  ['0000011', 3],
  ['010', -1],
  ['000010', -2],
  ['0000010', -3],
];
let modeTable: Map<number, 'P' | 'H' | number> | undefined;

export interface CcittOptions {
  width: number;
  /** この塊 (ストリップ) の行数 */
  rows: number;
  /**
   * 2: 1 次元の符号。行をバイトの境目から始める (TIFF 6.0 Section 10)。
   * 3: T.4。行の前の EOL を読み飛ばす。twoDimensional なら EOL の後の 1 ビットで、次の行が 1 次元 (1) か 2 次元 (0) かを決める (T.4 4.2.2)。
   * 4: T.6。すべての行が 2 次元の符号で、最初の行の参照行は全部白。EOL は無い (TIFF 6.0 Section 11 の T6Options)
   */
  compression: 2 | 3 | 4;
  /** Compression=3 の T4Options の bit 0 (2 次元の符号を使う) */
  twoDimensional?: boolean;
  /** FillOrder (1 または 2) */
  fillOrder?: number;
}

/** 2 次元の符号の行がありうるか (T.6、または T4Options の bit 0 の立った T.4) */
export const ccittTwoDimensional = (o: Pick<CcittOptions, 'compression' | 'twoDimensional'>): boolean => o.compression === 4 || (o.compression === 3 && !!o.twoDimensional);

/**
 * 幅 width・rows 行の CCITT の画像を、dataBytes バイトの符号から読んでよいか (imageLimits.ts の CCITT_1D_PIXELS_PER_BYTE・CCITT_2D_PIXELS_PER_BYTE・ccittRowLimit)。
 * 2 次元の符号なら、行の数はデータのビット数まで (1 行は 1 ビット以上)。画素の数は、1 次元・2 次元の符号の密度の上限と MAX_PIXELS まで
 * (寸法だけを大きくした 138 バイトの T.6 の TIFF で、1 億画素の配列を作り、11 秒・2.1GB を使っていた。IMG-19)
 */
export function ccittFits(width: number, rows: number, dataBytes: number, twoDimensional: boolean): boolean {
  if (twoDimensional && rows > ccittRowLimit(dataBytes)) return false;
  return width * rows <= pixelBudget(dataBytes, twoDimensional ? CCITT_2D_PIXELS_PER_BYTE : CCITT_1D_PIXELS_PER_BYTE);
}

/**
 * 1 つのストリップを展開する。戻り値は 1 画素 1 バイト (1 = CCITT の黒、0 = 白)。行の連なりの和が幅と合わないなど、
 * 読めなければ undefined
 */
export function decodeModifiedHuffman(data: Uint8Array, o: CcittOptions): Uint8Array | undefined {
  tables ??= { white: build(WHITE), black: build(BLACK) };
  modeTable ??= new Map(MODES.map(([c, m]) => [key(c.length, parseInt(c, 2)), m]));
  const { white, black } = tables;
  const W = o.width;
  // 画素の数の上限 (頭に書かれた寸法だけで大量のメモリ・時間を使わない)。MAX_PIXELS と、データの大きさで縛る (ccittFits)
  if (!(W > 0) || !(o.rows > 0) || !ccittFits(W, o.rows, data.length, ccittTwoDimensional(o))) return undefined;
  const out = new Uint8Array(W * o.rows);
  const nbits = data.length * 8;
  let pos = 0;
  const lsb = o.fillOrder === 2;
  const bit = (p: number) => {
    const b = data[p >> 3];
    return lsb ? (b >> (p & 7)) & 1 : (b >> (7 - (p & 7))) & 1;
  };
  /** 表から符号を 1 つ読む (読めなければ undefined) */
  const read = <T>(t: Map<number, T>, max: number): T | undefined => {
    let v = 0;
    for (let len = 1; len <= max && pos < nbits; len++) {
      v = (v << 1) | bit(pos++);
      const r = t.get(key(len, v));
      if (r !== undefined) return r;
    }
    return undefined;
  };
  /** 1 つの連なりの長さ (0 個以上の Make-up と 1 つの Terminating の和。読めなければ -1) */
  const run = (isBlack: boolean): number => {
    let n = 0;
    for (;;) {
      const r = read(isBlack ? black : white, MAX_CODE);
      if (r === undefined) return -1;
      n += r;
      if (r < 64) return n;
    }
  };
  /** 行 y の [x0, x1) を塗る (黒なら 1) */
  const paint = (y: number, x0: number, x1: number, isBlack: boolean) => {
    if (isBlack && x1 > x0) out.fill(1, y * W + Math.max(x0, 0), y * W + Math.min(x1, W));
  };
  /** p から n ビットが code と同じか */
  const peek = (code: string) => {
    if (pos + code.length > nbits) return false;
    for (let k = 0; k < code.length; k++) if (bit(pos + k) !== (code.charCodeAt(k) - 48)) return false;
    return true;
  };
  /**
   * 非圧縮の形 (T.4 の Table 5/T.4。入る符号は読んだ後)。画素の並び 1・01・001・0001・00001 (白 n 個と黒 1 個)、000001 (白 5 個)、
   * 抜ける符号 0000001T〜00000000001T (白 0〜4 個の後に抜ける。T は次の連なりの色: 1 = 黒)。抜けた後の x と色を返す
   */
  const uncompressed = (y: number, x0: number): { x: number; isBlack: boolean } | undefined => {
    let x = x0;
    for (;;) {
      let z = 0;
      while (pos < nbits && bit(pos) === 0 && z < 11) {
        z++;
        pos++;
      }
      if (pos >= nbits || z > 10) return undefined;
      pos++; // 1
      if (z <= 4) {
        if (x + z + 1 > W) return undefined;
        paint(y, x + z, x + z + 1, true);
        x += z + 1;
      } else if (z === 5) {
        if (x + 5 > W) return undefined;
        x += 5;
      } else {
        x += z - 6;
        if (x > W || pos >= nbits) return undefined;
        return { x, isBlack: bit(pos++) === 1 };
      }
    }
  };
  /** 1 次元の符号の行 (読めなければ false) */
  const line1d = (y: number): boolean => {
    let x = 0;
    let isBlack = false;
    while (x < W) {
      if (peek('000000001111')) {
        // 非圧縮の形へ (1 次元の行の入る符号)
        pos += 12;
        const u = uncompressed(y, x);
        if (!u) return false;
        x = u.x;
        isBlack = u.isBlack;
        continue;
      }
      const r = run(isBlack);
      if (r < 0 || x + r > W) return false;
      paint(y, x, x + r, isBlack);
      x += r;
      isBlack = !isBlack;
    }
    return true;
  };
  /**
   * 2 次元の符号の行 (T.4 4.2.1.3)。ref は参照行の色の変わる位置 (白から始まる)。a0 は行の頭の前の仮の白の位置 (-1) から始め、
   * 行の後ろの仮の変わる位置 (W) を符号にし終えるまで続ける。b1・b2 が無ければ W に置く (4.2.1.3.4)。読めなければ false
   */
  const line2d = (y: number, ref: number[]): boolean => {
    let a0 = -1;
    let isBlack = false;
    // 参照行の、a0 より右の最初の変わり目の番号。a0 は行の中で左へ戻らず、変わり目の位置は昇順なので、行の中で持ち越せる
    // (符号ごとに頭から探すと、変わり目の多い行で、幅の 2 乗の手間になる)
    let j = 0;
    while (a0 < W) {
      // b1: a0 より右で、a0 と反対の色に変わる参照行の位置 (参照行の i 番目の変わり目は、i が偶数なら黒へ、奇数なら白へ)。
      // a0 より右の最初の変わり目 j か、色の向きが合わなければその次 (向きは 1 つおきに入れ替わる)
      while (j < ref.length && ref[j] <= a0) j++;
      const i = j < ref.length && (j % 2 === 0) === isBlack ? j + 1 : j;
      const b1 = i < ref.length ? ref[i] : W;
      const b2 = i + 1 < ref.length ? ref[i + 1] : W;
      if (peek('0000001111')) {
        // 非圧縮の形へ (2 次元の行の入る符号。Table 4/T.4 の拡張 0000001xxx の xxx = 111)
        pos += 10;
        const u = uncompressed(y, Math.max(a0, 0));
        if (!u) return false;
        a0 = u.x;
        isBlack = u.isBlack;
        continue;
      }
      const m = read(modeTable!, 7);
      if (m === undefined) return false;
      if (m === 'P') {
        // パス: a0 を b2 の真下へ (色は変えない)
        paint(y, a0, b2, isBlack);
        a0 = b2;
      } else if (m === 'H') {
        // 水平: a0a1・a1a2 を 1 次元の符号で (行の頭では a0a1 − 1 を符号にする、つまり位置 0 から数える)
        const start = Math.max(a0, 0);
        const r1 = run(isBlack);
        const r2 = r1 < 0 ? -1 : run(!isBlack);
        if (r2 < 0) return false;
        const a1 = start + r1;
        const a2 = a1 + r2;
        if (a2 > W) return false;
        paint(y, start, a1, isBlack);
        paint(y, a1, a2, !isBlack);
        a0 = a2;
      } else {
        // 垂直: a1 = b1 + d。a0 を a1 へ、色を変える
        const a1 = b1 + m;
        if (a1 < Math.max(a0, 0) || a1 > W) return false;
        paint(y, a0, a1, isBlack);
        a0 = a1;
        isBlack = !isBlack;
      }
    }
    return true;
  };
  /** 行 y の色の変わる位置 (行の頭の前は白) */
  const changesOf = (y: number): number[] => {
    const c: number[] = [];
    let prev = 0;
    for (let x = 0; x < W; x++) {
      const v = out[y * W + x];
      if (v !== prev) c.push(x);
      prev = v;
    }
    return c;
  };
  /** 行の前の EOL (0 が 11 個以上続いた後の 1。前の埋めの 0 を含む) を読み飛ばす。あれば true */
  const skipEol = (): boolean => {
    let z = pos;
    while (z < nbits && bit(z) === 0) z++;
    if (z - pos >= 11 && z < nbits) {
      pos = z + 1;
      return true;
    }
    return false;
  };
  let ref: number[] = []; // 参照行 (T.6 の最初の行は全部白)
  for (let y = 0; y < o.rows; y++) {
    let twoD = o.compression === 4;
    if (o.compression === 3) {
      const eol = skipEol();
      if (o.twoDimensional) {
        // EOL の後の 1 ビット: 1 なら 1 次元、0 なら 2 次元 (EOL が無ければ、どちらか決められない)
        if (!eol || pos >= nbits) return undefined;
        twoD = bit(pos++) === 0;
      }
    }
    if (!(twoD ? line2d(y, ref) : line1d(y))) return undefined;
    ref = changesOf(y);
    if (o.compression === 2) pos = (pos + 7) & ~7;
  }
  return out;
}
