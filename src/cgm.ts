/**
 * cgm — CGM (Computer Graphics Metafile) の 2 進符号化を読み、絵 (picture) を SVG にする。
 *
 * 仕様: ISO/IEC 8632-1:1999 (機能仕様。要素の意味・既定値。正誤表 1:2006・2:2007 を含む) と ISO/IEC 8632-3:1999 (2 進符号化)。
 *  - 命令の見出し (第 3 部 5.4): 1 語 (16 ビット) = 類 (4 ビット)・番号 (7 ビット)・引数の長さ (5 ビット)。
 *    長さ 31 は長い形: 次の語の下位 15 ビットが長さ、最上位ビットが「続きあり」。命令は語の境目から始まる (奇数長は 1 octet 埋める)
 *  - 数値の形 (第 3 部 6 章): 符号付き・符号無し整数 (8/16/24/32 ビット)、固定小数点 (整数部 SI + 小数部 UI / 2^n)、IEEE 754 浮動小数点。
 *    すべて上位バイトが先 (big-endian)
 *  - 引数の型 (第 3 部 7 章 表 1): VDC は VDC TYPE で整数か実数、CO は COLOUR SELECTION MODE で色番号か直接色、
 *    SS は幅の指定の流儀 (absolute なら VDC、ほかは実数)、文字列は長さ (0..254、255 なら次の 16 ビット) と文字
 *  - 要素の番号と引数 (第 3 部 8 章 表 3〜表 12)、既定値 (第 1 部 8 章・第 3 部 9 章)
 * 座標: VDC EXTENT の第 1 の角が見る人にとっての左下、第 2 の角が右上 (第 1 部 6.4.4)。正の角度は +x から +y へ (同)。
 * 表示装置しだいと定められている値 (背景色・前景色・scaled の線の太さの基準など) は、このファイルの定数で決める。
 * 登録簿 (ISO International Register of Graphical Items) の要素: ESCAPE 22 (Transparent Cell Colour)・45 (Alpha Transparency)、
 * 色の型 6・7・8 (RGB-alpha・sRGB・sRGB-alpha)、TILE の圧縮の形 7・8・9 (baseline JPEG・LZW・PNG の deflate) を読む。
 * 描かない要素: GENERALIZED DRAWING PRIMITIVE (中身は登録簿で決まるが、登録された GDP が無い)、POLYSYMBOL (記号の表はメタファイルの外のもので、
 * 登録された表も無い)、ほかの ESCAPE。どれも警告に出す。LINE CAP の triangle と dash cap は SVG に無いので、butt で描く
 */
import { base64 } from './base64';
import { decodeModifiedHuffman } from './ccitt';
import { fontFamilyOf } from './eps';
import { MAX_PIXELS, metafilePixelBudget, metafileSvgBudget } from './imageLimits';
import { decodeJpeg } from './jpeg';
import { encodePngStored } from './pixels';
import { inflateBytes, lzwBytes } from './psFilters';

export interface CgmResult {
  svg: string;
  /** SVG の大きさ (px) */
  width: number;
  height: number;
  /** 描いた図形の数 */
  count: number;
  /** 描けなかった要素 (要素名ごとに 1 回) */
  warnings: string[];
}

const PX_PER_MM = 96 / 25.4;
/** 縮尺が abstract のときの絵の幅 (px)。imageInfo の cgmInfo と同じ */
const ABSTRACT_WIDTH = 400;
/** 表示装置しだいの値 (第 1 部 8 章 "device-dependent"): 背景色と前景色 */
const DEVICE_BACKGROUND: Rgb = [1, 1, 1];
const DEVICE_FOREGROUND: Rgb = [0, 0, 0];
/**
 * 表示装置しだいの値 (第 1 部 6.7.5 'scaled'): 線・辺の太さの基準 (倍率 1 の太さ。px)。
 * Kumiori では 0.192pt とする。
 * scaled・mm の太さは表示装置の上の太さなので、vector-effect="non-scaling-stroke" を付けて、絵を拡大縮小しても変えない
 */
const NOMINAL_LINE_WIDTH = 0.192 / 0.75;
/** scaled の印の大きさの基準 (px)。Kumiori では 1.34pt とする (大きさ 1・5・10・20 の × が 1.34・6.7・13.4・26.8pt) */
const NOMINAL_MARKER_SIZE = 1.34 / 0.75;
/**
 * 文字の高さ (CHARACTER HEIGHT。基線から CAPLINE まで。第 1 部 7.7.15) から SVG の font-size を出す比。
 * 書体の大文字の高さは書体ごとに違い、ここでは書体を読まないので、仮に 0.72 em とする (仮定)
 */
const CAP_HEIGHT_EM = 0.72;

type Rgb = [number, number, number];
type Pt = [number, number];

/** 実数の形 (REAL PRECISION・VDC REAL PRECISION。第 3 部 表 4 の 5 番) */
interface RealForm {
  float: boolean;
  /** 指数部 (浮動) または整数部 (固定) のビット数 */
  a: number;
  /** 仮数部 (浮動) または小数部 (固定) のビット数 */
  b: number;
}

type SpecMode = 0 | 1 | 2 | 3; // absolute / scaled / fractional / mm

/** 絵の状態 (第 1 部 8 章の既定値。METAFILE DEFAULTS REPLACEMENT で置き換わり、BEGIN PICTURE ごとに戻る) */
interface State {
  // 精度 (メタファイル記述子・制御要素)
  vdcType: 0 | 1;
  intPrec: number;
  realForm: RealForm;
  indexPrec: number;
  colourPrec: number;
  colourIndexPrec: number;
  namePrec: number;
  vdcIntPrec: number;
  vdcRealForm: RealForm;
  colourModel: number;
  /** COLOUR VALUE EXTENT (RGB・CMYK): 最小と最大 */
  cvMin: number[];
  cvMax: number[];
  /** COLOUR VALUE EXTENT (CIELAB・CIELUV・RGB 関連): 成分ごとの倍率とずれ (s1, o1, s2, o2, s3, o3)。値 = 倍率 × CD + ずれ */
  cvScale: number[];
  /** COLOUR CALIBRATION の基準の白 (XYZ。Y = 1)。無ければ D65 */
  white: [number, number, number] | undefined;
  // 絵の記述子
  scalingMetric: number | undefined;
  colourSelection: 0 | 1; // indexed / direct
  lineWidthMode: SpecMode;
  markerSizeMode: SpecMode;
  edgeWidthMode: SpecMode;
  vdcExtent: [Pt, Pt] | undefined;
  background: Rgb | undefined;
  // 制御
  clip: [Pt, Pt] | undefined;
  clipOn: boolean;
  // 属性
  lineType: number;
  lineWidth: number[]; // 流儀ごとの現在値 (第 1 部 6.4.3)
  lineColour: Colour;
  lineCap: number;
  lineJoin: number;
  markerType: number;
  markerSize: number[];
  markerColour: Colour;
  textFont: number;
  charExpansion: number;
  charSpacing: number;
  textColour: Colour;
  charHeight: number | undefined;
  charOrientation: [number, number, number, number] | undefined;
  textPath: number;
  textAlign: [number, number, number, number];
  restrictedType: number;
  interiorStyle: number;
  /** INTERIOR STYLE SPECIFICATION MODE (第 3 部 表 5 の 16 番) */
  interiorMode: SpecMode;
  /** FILL REFERENCE POINT (既定は既定の VDC EXTENT の左下。第 1 部 8 章) */
  fillRef: Pt | undefined;
  /** INTERPOLATED INTERIOR (第 1 部 7.7.43): 形 (1 平行・2 楕円・3 三角形)・基準の形・段の区切り・色 */
  interp: { style: number; geo: number[]; stages: number[]; colours: Colour[] } | undefined;
  fillColour: Colour;
  hatchIndex: number;
  edgeType: number;
  edgeWidth: number[];
  edgeColour: Colour;
  edgeVisible: boolean;
  edgeCap: number;
  edgeJoin: number;
  /** 色表 (番号 → 色)。無い番号は表示装置しだい (0 は背景色、ほかは前景色。第 1 部 8 章) */
  colourTable: Map<number, Rgb>;
  fonts: string[];
  /** LINE AND EDGE TYPE DEFINITION (第 1 部 7.4.17): 負の線種番号 → 1 周期の長さ (定義した時の LINE WIDTH SPECIFICATION MODE の単位) と、線・隙間の並び */
  lineTypeDefs: Map<number, { repeat: number; mode: SpecMode; dashes: number[] }>;
  /** HATCH STYLE DEFINITION (第 1 部 7.4.18): 負の模様の線の番号 → 定義 (単位は定義した時の INTERIOR STYLE SPECIFICATION MODE) */
  hatchDefs: Map<number, { cross: boolean; dirs: number[]; duty: number; gaps: number[]; types: number[]; mode: SpecMode }>;
  /** PATTERN INDEX (第 1 部 7.7.25) */
  patternIndex: number;
  /** PATTERN TABLE (第 1 部 7.7.32): 番号 → nx × ny の色 (1 行目から) */
  /**
   * PATTERN TABLE の模様。セルの色は、違う色の並び (palette) と、セルごとのその番号 (cells) で持つ (セルごとに色のオブジェクトを持つと、
   * 精度 1 ビットの表は、データの 1 バイトが 8 個のオブジェクト (約 300 バイト) になる)。uid は定義ごとの通し番号 (中身を見分ける鍵)
   */
  patternTable: Map<number, { nx: number; ny: number; uid: number; palette: Colour[]; cells: Uint32Array }>;
  /** PATTERN SIZE (第 1 部 7.7.33): 高さの向き (x, y)・幅の向き (x, y)。無ければ既定 (既定の VDC EXTENT の高さと幅) */
  patternSize: number[] | undefined;
  /** GEOMETRIC PATTERN DEFINITION (第 1 部 7.4.19): 番号 → セグメントと、模様にする範囲 */
  geoPatterns: Map<number, { seg: number; ext: [Pt, Pt] }>;
  /** TRANSPARENT CELL COLOUR (第 1 部 7.5.20。と、登録簿の ESCAPE 22): この色のセルは描かない */
  transparentCell: Colour | undefined;
  /** 色表の不透明度 (色の型 6・8 の 4 つ目の成分。1 のものは持たない) */
  colourTableAlpha: Map<number, number>;
  /** 登録簿の ESCAPE 45 (Alpha Transparency): 後の図形の不透明度 (0..1) */
  alpha: number;
  /** MITRE LIMIT (第 1 部 7.5.15・6.5.6): 尖ったつなぎの長さの、線の太さに対する上限 */
  mitreLimit: number;
  /** LINE / EDGE TYPE CONTINUATION (第 1 部 7.7.39): 1 指定なし・2 続ける・3 頂点ごとに始め直す・4 頂点を必ず描く */
  lineCont: number;
  edgeCont: number;
  /** LINE / EDGE TYPE INITIAL OFFSET (第 1 部 7.7.40): 線種の 1 周期のどこから描き始めるか (0〜1) */
  lineOffset: number;
  edgeOffset: number;
  /** TEXT SCORE TYPE (第 1 部 7.7.41): on の飾りの種類 (1 右・2 左・3 中・4 圏点) */
  scores: number[];
  /** TEXT PRECISION (string・character・stroke)。描き方は同じ */
  textPrecision: number;
  /** CHARACTER SET LIST (第 1 部 7.3.14): 番号 (1 から) → 種類と、指示の列の終わり */
  charSets: Array<{ type: number; tail: string }>;
  /** CHARACTER CODING ANNOUNCER (第 1 部 7.3.15): 0 基本 7 ビット・1 基本 8 ビット・2 拡張 7 ビット・3 拡張 8 ビット */
  codingAnnouncer: number;
  /** CHARACTER SET INDEX・ALTERNATE CHARACTER SET INDEX (第 1 部 7.7.19・7.7.20) */
  charSetIndex: number;
  altCharSetIndex: number;
  /** GENERALIZED TEXT PATH MODE (第 1 部 7.5.14): 0 off・1 non-tangential・2 axis-tangential */
  textPathMode: number;
  /** 複合の文字の経路 (BEGIN COMPOUND TEXT PATH 〜 END。SVG の経路 px)。無ければ既定 (既定の VDC EXTENT の下の辺) */
  textPathD: string | undefined;
  /** 束ね表 (LINE / MARKER / TEXT / FILL / EDGE REPRESENTATION。第 1 部 7.4.11〜7.4.15) */
  bundles: {
    line: Map<number, { type: number; width: number; mode: SpecMode; colour: Colour }>;
    marker: Map<number, { type: number; size: number; mode: SpecMode; colour: Colour }>;
    text: Map<number, { font: number; precision: number; spacing: number; expansion: number; colour: Colour }>;
    fill: Map<number, { style: number; colour: Colour; hatch: number; pattern: number }>;
    edge: Map<number, { type: number; width: number; mode: SpecMode; colour: Colour }>;
  };
  lineBundle: number;
  markerBundle: number;
  textBundle: number;
  fillBundle: number;
  edgeBundle: number;
  /** ASPECT SOURCE FLAGS (第 1 部 7.7.35): 18 の見た目ごとに、束ね表を使うか (true) 個別の値か */
  asf: boolean[];
  /** INHERITANCE FILTER (第 1 部 7.10.2) で 'state list' にした属性 (COPY SEGMENT で、写す時の値を使う)。ASF は 'asf0'〜'asf17' */
  inherit: string[];
}

/**
 * INHERITANCE FILTER の選び方の番号 (第 3 部 表 11 の 2 番) → 状態の項目 (第 1 部 7.10.2 の表 6・表 7)。ASF は 'asf0'〜'asf17'。
 * 切り抜きの方法 (clipping mode)・補助の色・透明・選び出しの番号・記号の属性は、描き方に関わらないので空
 */
const INHERIT: Record<number, string[]> = (() => {
  const line = ['lineBundle', 'lineType', 'lineWidth', 'lineColour', 'lineCap', 'lineJoin', 'lineCont', 'lineOffset'];
  const marker = ['markerBundle', 'markerType', 'markerSize', 'markerColour'];
  const textPres = ['textBundle', 'textFont', 'textPrecision', 'charExpansion', 'charSpacing', 'textColour', 'charHeight', 'scores', 'restrictedType'];
  const textPlace = ['charOrientation', 'textPath', 'textAlign'];
  const fill = ['fillBundle', 'interiorStyle', 'fillColour', 'hatchIndex', 'patternIndex', 'interp'];
  const edge = ['edgeBundle', 'edgeType', 'edgeWidth', 'edgeColour', 'edgeVisible', 'edgeCap', 'edgeJoin', 'edgeCont', 'edgeOffset'];
  const pattern = ['fillRef', 'patternSize'];
  const output = ['mitreLimit'];
  const asf = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => `asf${a + k}`);
  const all = [...line, ...marker, ...textPres, ...textPlace, ...fill, ...edge, ...pattern, ...output];
  const single = ['lineBundle', 'lineType', 'lineWidth', 'lineColour', '', 'markerBundle', 'markerType', 'markerSize', 'markerColour', '', 'textBundle', 'textFont', 'textPrecision', 'charExpansion', 'charSpacing', 'textColour', 'charHeight', 'charOrientation', 'textPath', 'textAlign', 'fillBundle', 'interiorStyle', 'fillColour', 'hatchIndex', 'patternIndex', 'edgeBundle', 'edgeType', 'edgeWidth', 'edgeColour', 'edgeVisible', '', 'fillRef', 'patternSize', '', ''];
  const m: Record<number, string[]> = {};
  single.forEach((k, i) => (m[i] = k ? [k] : []));
  Object.assign(m, { 35: line, 36: marker, 37: textPres, 38: textPlace, 39: fill, 40: edge, 41: pattern, 42: output, 43: [], 44: all, 45: [...all, ...asf(0, 17)] });
  for (let k = 0; k < 18; k++) m[46 + k] = [`asf${k}`];
  Object.assign(m, { 64: asf(0, 2), 65: asf(3, 5), 66: asf(6, 10), 67: asf(11, 14), 68: asf(15, 17), 69: asf(0, 17) });
  ['mitreLimit', 'lineCap', 'lineJoin', 'lineCont', 'lineOffset', 'scores', 'restrictedType', 'interp', 'edgeCap', 'edgeJoin', 'edgeCont', 'edgeOffset'].forEach((k, i) => (m[70 + i] = [k]));
  for (let k = 82; k <= 86; k++) m[k] = [];
  return m;
})();

/** 色: 色番号 (indexed) か直接色 (direct)。色表の参照は描くときに行う */
type Colour = { index: number } | { rgb: Rgb; a?: number };

/** 色の型の直接色の成分の数 (4 CMYK・6 RGB-alpha・8 sRGB-alpha は 4、ほかは 3) */
const compsOf = (model: number) => (model === 4 || model === 6 || model === 8 ? 4 : 3);
/** 色の型が RGB の仲間か (1 RGB・6 RGB-alpha・7 sRGB・8 sRGB-alpha。COLOUR VALUE EXTENT は最小と最大の直接色) */
const rgbLike = (model: number) => model === 1 || model === 6 || model === 7 || model === 8;

const fixed32: RealForm = { float: false, a: 16, b: 16 };
const float32: RealForm = { float: true, a: 9, b: 23 };

/** 第 3 部 9 章の符号化の既定値と、第 1 部 8 章の既定値 */
function initialState(): State {
  return {
    vdcType: 0,
    intPrec: 16,
    realForm: { ...fixed32 },
    indexPrec: 16,
    colourPrec: 8,
    colourIndexPrec: 8,
    namePrec: 16,
    vdcIntPrec: 16,
    vdcRealForm: { ...fixed32 },
    colourModel: 1,
    cvMin: [0, 0, 0, 0],
    cvMax: [255, 255, 255, 255],
    cvScale: [0, 0, 0, 0, 0, 0],
    white: undefined,
    scalingMetric: undefined,
    colourSelection: 0,
    lineWidthMode: 1,
    markerSizeMode: 1,
    edgeWidthMode: 1,
    vdcExtent: undefined,
    background: undefined,
    clip: undefined,
    clipOn: true,
    lineType: 1,
    lineWidth: [NaN, 1.0, 0.001, 0.35],
    lineColour: { index: 1 },
    lineCap: 1,
    lineJoin: 1,
    markerType: 3,
    markerSize: [NaN, 1.0, 0.01, 2.5],
    markerColour: { index: 1 },
    textFont: 1,
    charExpansion: 1,
    charSpacing: 0,
    textColour: { index: 1 },
    charHeight: undefined,
    charOrientation: undefined,
    textPath: 0,
    textAlign: [0, 0, 0, 0],
    restrictedType: 1,
    interiorStyle: 0,
    interiorMode: 0,
    fillRef: undefined,
    interp: undefined,
    fillColour: { index: 1 },
    hatchIndex: 1,
    edgeType: 1,
    edgeWidth: [NaN, 1.0, 0.001, 0.35],
    edgeColour: { index: 1 },
    edgeVisible: false,
    edgeCap: 1,
    edgeJoin: 1,
    colourTable: new Map(),
    fonts: [],
    lineTypeDefs: new Map(),
    hatchDefs: new Map(),
    patternIndex: 1,
    patternTable: new Map(),
    patternSize: undefined,
    geoPatterns: new Map(),
    transparentCell: undefined,
    colourTableAlpha: new Map(),
    alpha: 1,
    mitreLimit: 32767,
    lineCont: 1,
    edgeCont: 1,
    lineOffset: 0,
    edgeOffset: 0,
    scores: [],
    textPrecision: 0,
    charSets: [],
    codingAnnouncer: 0,
    charSetIndex: 1,
    altCharSetIndex: 1,
    textPathMode: 0,
    textPathD: undefined,
    bundles: { line: new Map(), marker: new Map(), text: new Map(), fill: new Map(), edge: new Map() },
    lineBundle: 1,
    markerBundle: 1,
    textBundle: 1,
    fillBundle: 1,
    edgeBundle: 1,
    asf: new Array(18).fill(false),
    inherit: [],
  };
}

function cloneState(s: State): State {
  return {
    ...s,
    realForm: { ...s.realForm },
    vdcRealForm: { ...s.vdcRealForm },
    cvMin: [...s.cvMin],
    cvMax: [...s.cvMax],
    cvScale: [...s.cvScale],
    lineWidth: [...s.lineWidth],
    markerSize: [...s.markerSize],
    edgeWidth: [...s.edgeWidth],
    textAlign: [...s.textAlign] as State['textAlign'],
    colourTable: new Map(s.colourTable),
    colourTableAlpha: new Map(s.colourTableAlpha),
    fonts: [...s.fonts],
    lineTypeDefs: new Map(s.lineTypeDefs),
    hatchDefs: new Map(s.hatchDefs),
    patternTable: new Map(s.patternTable),
    geoPatterns: new Map(s.geoPatterns),
    scores: [...s.scores],
    charSets: [...s.charSets],
    bundles: { line: new Map(s.bundles.line), marker: new Map(s.bundles.marker), text: new Map(s.bundles.text), fill: new Map(s.bundles.fill), edge: new Map(s.bundles.edge) },
    asf: [...s.asf],
    inherit: [...s.inherit],
  };
}

/** 引数を読む (第 3 部 6・7 章)。1 つの要素の引数 (分割された長い形はつないだもの) を、ビット単位で読む */
class Params {
  private bit = 0;
  constructor(
    readonly d: Uint8Array,
    private s: State,
  ) {}
  get left(): number {
    return this.d.length * 8 - this.bit;
  }
  get pos(): number {
    return this.bit >> 3;
  }
  /** バイトの位置へ移る */
  seekByte(n: number) {
    this.bit = n * 8;
  }
  /** 次の語 (16 ビット) の境目へ進む (CELL ARRAY の行の始め) */
  alignWord() {
    this.bit = Math.ceil(this.bit / 16) * 16;
  }
  /** 残りのバイト (次のバイトの境目から。BITONAL TILE・TILE の BS) */
  rest(): Uint8Array {
    return this.d.subarray(Math.ceil(this.bit / 8));
  }
  private bits(n: number): number {
    // 上位ビットが先
    let v = 0;
    if ((this.bit & 7) === 0 && (n & 7) === 0) {
      // バイトの境目から、バイトの倍数を読む (セルの色の並びの大半。1 ビットずつ読むのと同じ値)
      let o = this.bit >> 3;
      for (let k = 0; k < n; k += 8) v = v * 256 + (this.d[o++] ?? 0);
      this.bit += n;
      return v;
    }
    for (let k = 0; k < n; k++) {
      const byte = this.d[this.bit >> 3] ?? 0;
      v = v * 2 + ((byte >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return v;
  }
  uint(prec: number): number {
    return this.bits(prec);
  }
  sint(prec: number): number {
    const u = this.bits(prec);
    return u >= 2 ** (prec - 1) ? u - 2 ** prec : u;
  }
  real(f: RealForm): number {
    if (!f.float) {
      // 固定小数点: 整数部 SI + 小数部 UI / 2^n (第 3 部 6.4.3)
      const whole = this.sint(f.a);
      const frac = this.uint(f.b);
      return whole + frac / 2 ** f.b;
    }
    // IEEE 754 (第 3 部 6.5)
    const bytes = new Uint8Array(f.a + f.b > 32 ? 8 : 4);
    for (let k = 0; k < bytes.length; k++) bytes[k] = this.bits(8);
    const v = new DataView(bytes.buffer);
    return bytes.length === 8 ? v.getFloat64(0, false) : v.getFloat32(0, false);
  }
  /** 浮動小数点で書かれる実数 (SCALING MODE の倍率など。第 3 部 表 1 の注 10) */
  floatReal(): number {
    return this.real(this.s.realForm.float ? this.s.realForm : float32);
  }
  I(): number {
    return this.sint(this.s.intPrec);
  }
  R(): number {
    return this.real(this.s.realForm);
  }
  IX(): number {
    return this.sint(this.s.indexPrec);
  }
  E(): number {
    return this.sint(16);
  }
  N(): number {
    return this.sint(this.s.namePrec);
  }
  VDC(): number {
    return this.s.vdcType === 0 ? this.sint(this.s.vdcIntPrec) : this.real(this.s.vdcRealForm);
  }
  P(): Pt {
    return [this.VDC(), this.VDC()];
  }
  CI(prec = this.s.colourIndexPrec): number {
    return this.uint(prec);
  }
  CD(prec = this.s.colourPrec): number[] {
    const n = compsOf(this.s.colourModel);
    const out: number[] = [];
    for (let k = 0; k < n; k++) out.push(this.uint(prec));
    return out;
  }
  CO(): Colour {
    return this.s.colourSelection === 0 ? { index: this.CI() } : directColour(this.s, this.CD());
  }
  /** SS: 流儀が absolute なら VDC、ほかは実数 */
  SS(mode: SpecMode): number {
    return mode === 0 ? this.VDC() : this.R();
  }
  /** 構造のある記録 SDR (第 3 部 表 1 の注 17): 文字列と同じ形で包んだ、ほかの型の値の並び。中身のバイトを返す */
  SDR(): Uint8Array {
    return Uint8Array.from(this.S(), (c) => c.charCodeAt(0));
  }
  /** 文字列 (第 3 部 表 1 の注 6) */
  S(): string {
    let out = '';
    let n = this.uint(8);
    let more = false;
    if (n === 255) {
      const w = this.uint(16);
      more = (w & 0x8000) !== 0;
      n = w & 0x7fff;
    }
    for (;;) {
      for (let k = 0; k < n && this.left >= 8; k++) out += String.fromCharCode(this.uint(8));
      if (!more || this.left < 16) break;
      const w = this.uint(16);
      more = (w & 0x8000) !== 0;
      n = w & 0x7fff;
    }
    return out;
  }
}

/** D65 の白 (XYZ。Y = 1) */
const D65: [number, number, number] = [0.95047, 1, 1.08883];
/** XYZ (基準の白 w) を sRGB (0..1) にする。白が D65 でなければ、XYZ の比で D65 へ寄せる (簡単な順応) */
function xyzToRgb(x: number, y: number, z: number, w: [number, number, number]): Rgb {
  const X = (x * D65[0]) / w[0];
  const Y = (y * D65[1]) / w[1];
  const Z = (z * D65[2]) / w[2];
  const lin = [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
  const g = (c: number) => {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return [g(lin[0]), g(lin[1]), g(lin[2])];
}

/**
 * 直接色の不透明度 (0..1)。登録簿の色の型 6 (RGB-alpha)・8 (sRGB-alpha) の 4 つ目の成分 (COLOUR VALUE EXTENT で正規化。
 * 最小が透明、最大が不透明。成分は不透明度を掛けていない値とする)。ほかの色の型は 1
 */
function toAlpha(s: State, v: number[]): number {
  if (s.colourModel !== 6 && s.colourModel !== 8) return 1;
  const lo = s.cvMin[3] ?? 0;
  const hi = s.cvMax[3] ?? 255;
  return hi === lo ? 1 : Math.min(1, Math.max(0, ((v[3] ?? hi) - lo) / (hi - lo)));
}
/** 直接色 (不透明度が 1 未満なら a も持つ) */
function directColour(s: State, v: number[]): Colour {
  const a = toAlpha(s, v);
  return a < 1 ? { rgb: toRgb(s, v), a } : { rgb: toRgb(s, v) };
}

/** 直接色を 0..1 の RGB にする (COLOUR VALUE EXTENT で正規化。CMYK・CIELAB・CIELUV は RGB に直す。第 1 部 7.3.10・7.3.19)。
 * 登録簿の色の型 6・7・8 (RGB-alpha・sRGB・sRGB-alpha) の色の成分は RGB と同じに読む (sRGB は出力の色と同じ) */
function toRgb(s: State, v: number[]): Rgb {
  if (s.colourModel === 2 || s.colourModel === 3 || s.colourModel === 5) {
    // 成分 = 倍率 × CD + ずれ (第 1 部 7.3.10 の注 2)
    const c = [0, 1, 2].map((k) => (s.cvScale[2 * k] ?? 0) * (v[k] ?? 0) + (s.cvScale[2 * k + 1] ?? 0));
    const w = s.white ?? D65;
    if (s.colourModel === 5) return [0, 1, 2].map((k) => Math.min(1, Math.max(0, c[k]))) as Rgb;
    const [L] = c;
    // L* から Y (CIE 1976)
    const fy = (L + 16) / 116;
    const Y = L > 8 ? fy ** 3 : L / 903.3;
    if (s.colourModel === 2) {
      // CIELAB: L*・a*・b*
      const f = (t: number) => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29));
      return xyzToRgb(w[0] * f(fy + c[1] / 500), w[1] * Y, w[2] * f(fy - c[2] / 200), w);
    }
    // CIELUV: L*・u*・v*
    const den = w[0] + 15 * w[1] + 3 * w[2];
    const un = (4 * w[0]) / den;
    const vn = (9 * w[1]) / den;
    if (!(L > 0)) return [0, 0, 0];
    const u = c[1] / (13 * L) + un;
    const vv = c[2] / (13 * L) + vn;
    if (!(vv > 0)) return [0, 0, 0];
    const YY = w[1] * Y;
    return xyzToRgb((YY * 9 * u) / (4 * vv), YY, (YY * (12 - 3 * u - 20 * vv)) / (4 * vv), w);
  }
  const n = (k: number) => {
    const lo = s.cvMin[k] ?? 0;
    const hi = s.cvMax[k] ?? 255;
    return hi === lo ? 0 : Math.min(1, Math.max(0, (v[k] - lo) / (hi - lo)));
  };
  if (s.colourModel === 4) {
    const k = n(3);
    return [(1 - n(0)) * (1 - k), (1 - n(1)) * (1 - k), (1 - n(2)) * (1 - k)];
  }
  return [n(0), n(1), n(2)];
}

/** 文字の並びを、名前の符号で読む (使えない符号なら undefined) */
function decodeWith(label: string, bytes: number[]): string | undefined {
  try {
    return new TextDecoder(label, { fatal: false }).decode(Uint8Array.from(bytes));
  } catch {
    return undefined;
  }
}
/** 96 字の G 集合の指示の列の終わり (ISO 2375 の登録簿) → ISO/IEC 8859 の符号の名前 */
const G96: Record<string, string> = { A: 'iso-8859-1', B: 'iso-8859-2', C: 'iso-8859-3', D: 'iso-8859-4', L: 'iso-8859-5', G: 'iso-8859-6', F: 'iso-8859-7', H: 'iso-8859-8', M: 'iso-8859-9', V: 'iso-8859-10', T: 'windows-874', Y: 'iso-8859-13', '_': 'iso-8859-14', b: 'iso-8859-15', f: 'iso-8859-16' };
type CharSet = { type: number; tail: string };
/** 1 つの G 集合の符号 (7 ビットの値の並び) を読む */
function decodeSet(cs: CharSet, codes: number[]): string {
  const tail = cs.tail;
  if (cs.type === 0) {
    // 94 字の集合: B は ISO 646 の国際版 (ASCII)、J は JIS X 0201 のローマ字、I は JIS X 0201 の片仮名、A は英国版
    if (tail === 'I') return codes.map((c) => (c >= 0x21 && c <= 0x5f ? String.fromCharCode(0xff61 + c - 0x21) : String.fromCharCode(c))).join('');
    if (tail === 'J') return codes.map((c) => (c === 0x5c ? '¥' : c === 0x7e ? '‾' : String.fromCharCode(c))).join('');
    if (tail === 'A') return codes.map((c) => (c === 0x23 ? '£' : String.fromCharCode(c))).join('');
    return codes.map((c) => String.fromCharCode(c)).join('');
  }
  if (cs.type === 1) {
    // 96 字の集合: ISO/IEC 8859 の右半分 (0xA0〜0xFF)
    const hi = codes.map((c) => c | 0x80);
    return decodeWith(G96[tail] ?? 'iso-8859-1', hi) ?? hi.map((c) => String.fromCharCode(c)).join('');
  }
  if (cs.type === 2 || cs.type === 3) {
    // 94 字の多バイトの集合 (2 バイト): @・B は JIS X 0208 (JIS C 6226)、A は GB 2312、C は KS C 5601、D は JIS X 0212
    const hi = codes.map((c) => c | 0x80);
    let out: string | undefined;
    if (tail === '@' || tail === 'B' || tail === 'O' || tail === 'Q') out = decodeWith('euc-jp', hi);
    else if (tail === 'A') out = decodeWith('gb18030', hi);
    else if (tail === 'C') out = decodeWith('euc-kr', hi);
    else if (tail === 'D') {
      const b: number[] = [];
      for (let k = 0; k + 1 < hi.length; k += 2) b.push(0x8f, hi[k], hi[k + 1]);
      out = decodeWith('euc-jp', b);
    }
    return out ?? '�'.repeat(codes.length >> 1);
  }
  return codes.map((c) => String.fromCharCode(c)).join('');
}
/** 完全な符号 (ESC 2/5 の後の列。G は UTF-8、/@・/C・/E は UCS-2、/J・/K・/L は UTF-16、/A・/D・/F は UCS-4) で読む。読めない列なら undefined */
function decodeComplete(tail: string, bytes: number[]): string | undefined {
  if (['G', '/G', '/H', '/I'].includes(tail)) return decodeWith('utf-8', bytes);
  if (['/@', '/C', '/E', '/J', '/K', '/L'].includes(tail)) return decodeWith('utf-16be', bytes);
  if (['/A', '/D', '/F'].includes(tail)) {
    let out = '';
    for (let k = 0; k + 3 < bytes.length; k += 4) {
      const cp = ((bytes[k] << 24) | (bytes[k + 1] << 16) | (bytes[k + 2] << 8) | bytes[k + 3]) >>> 0;
      out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
    }
    return out;
  }
  return undefined;
}
/**
 * 字の文字列の符号を読む (第 1 部 6.3.4・7.3.14・7.3.15・7.7.19・7.7.20)。CHARACTER SET INDEX の集合を G0 (0x21〜0x7E)、
 * ALTERNATE CHARACTER SET INDEX の集合を G1 (8 ビットなら 0xA1〜0xFE、7 ビットなら SO の後) に置く。
 * 拡張の符号 (CHARACTER CODING ANNOUNCER が extended) では、文字列の中の ISO 2022 の指示 (ESC ( F・ESC ) F・ESC - F・ESC $ F・ESC $ ( F・ESC $ ) F・ESC % F) も読む。
 * CHARACTER SET LIST が無ければ、1 番は ISO 646 (ASCII) とし、8 ビットの右半分は Latin-1 とする (これまでどおり)
 */
function decodeText(st: State, raw: string): string {
  const bytes = Array.from(raw, (c) => c.charCodeAt(0) & 0xff);
  const set = (k: number): CharSet | undefined => st.charSets[k - 1];
  let g0 = set(st.charSetIndex);
  let g1 = set(st.altCharSetIndex);
  if (!st.charSets.length && !bytes.includes(0x1b)) return raw;
  if (g0?.type === 4) return decodeComplete(g0.tail, bytes) ?? raw;
  const extended = st.codingAnnouncer >= 2;
  const ascii: CharSet = { type: 0, tail: 'B' };
  let out = '';
  let shifted = false;
  let run: number[] = [];
  let runSet: CharSet | undefined;
  let latin1 = false;
  const flush = () => {
    if (!run.length) return;
    out += latin1 ? run.map((c) => String.fromCharCode(c | 0x80)).join('') : decodeSet(runSet ?? ascii, run);
    run = [];
  };
  const push = (cs: CharSet | undefined, c: number, l1 = false) => {
    if (cs !== runSet || l1 !== latin1) flush();
    runSet = cs;
    latin1 = l1;
    run.push(c);
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b && extended) {
      // ISO 2022 の指示: 中間の文字 (0x20〜0x2F) の並びと、終わりの文字
      let j = i + 1;
      const mid: number[] = [];
      while (j < bytes.length && bytes[j] >= 0x20 && bytes[j] <= 0x2f) mid.push(bytes[j++]);
      if (j >= bytes.length) break;
      const f = String.fromCharCode(bytes[j]);
      const m = String.fromCharCode(...mid);
      let cs: CharSet | undefined;
      let toG1 = false;
      if (m === '(' || m === ')') ((cs = { type: 0, tail: f }), (toG1 = m === ')'));
      else if (m === '-' || m === '.' || m === '/') ((cs = { type: 1, tail: f }), (toG1 = true));
      else if (m === '$' || m === '$(' || m === '$)') ((cs = { type: 2, tail: f }), (toG1 = m === '$)'));
      else if (m === '%' || m === '%/') {
        // 完全な符号へ移る: 残りをその符号で読む
        flush();
        const rest = bytes.slice(j + 1);
        out += decodeComplete(m.slice(1) + f, rest) ?? String.fromCharCode(...rest);
        return out;
      }
      if (cs) {
        flush();
        if (toG1) g1 = cs;
        else g0 = cs;
      }
      i = j;
      continue;
    }
    if (b === 0x0e && extended) {
      shifted = true;
      continue;
    }
    if (b === 0x0f && extended) {
      shifted = false;
      continue;
    }
    if (b < 0x20 || b === 0x7f) {
      push(ascii, b);
      continue;
    }
    if (b < 0x80) {
      const cs = shifted ? g1 : g0;
      // 空白 (0x20) は 94 字の集合に無いので、どの集合でも空白
      if (b === 0x20 && cs?.type !== 1 && cs?.type !== 3) push(ascii, b);
      else push(cs, b);
      continue;
    }
    if (b < 0xa0) {
      push(ascii, 0x3f);
      continue;
    }
    // 8 ビットの右半分: G1 の集合 (無ければ Latin-1)
    if (g1 && g1 !== g0) push(g1, b & 0x7f);
    else if (g1 && g1.type !== 0) push(g1, b & 0x7f);
    else push(undefined, b & 0x7f, true);
  }
  flush();
  return out;
}

/**
 * 構造のある記録 (SDR。第 1 部 附属書 C.2.2、第 3 部 表 1 の注 17) の項目を読む: (型の番号 IX、数 I、その型の値) の並び。
 * 型は 1 SDR・2 CI・3 CD・4 N・5 E・6 I・8〜10 IF8・IF16・IF32・11 IX・12 R・13 S・14 SF・15 VC・16 VDC・17 CCO・18 UI8・19 UI32・22 UI16。
 * BS (20)・CL (21) と知らない型が来たら、そこで止める
 */
function sdrMembers(p: Params, st: State): Array<{ type: number; values: unknown[] }> {
  const out: Array<{ type: number; values: unknown[] }> = [];
  while (p.left >= st.indexPrec + st.intPrec) {
    const type = p.IX();
    const n = p.I();
    if (n < 0 || n > 100000) break;
    const one: Record<number, () => unknown> = {
      1: () => p.SDR(),
      2: () => p.CI(),
      3: () => p.CD(),
      4: () => p.N(),
      5: () => p.E(),
      6: () => p.I(),
      8: () => p.sint(8),
      9: () => p.sint(16),
      10: () => p.sint(32),
      11: () => p.IX(),
      12: () => p.R(),
      13: () => p.S(),
      14: () => p.S(),
      15: () => p.VDC(),
      16: () => p.VDC(),
      17: () => p.uint(st.colourPrec),
      18: () => p.uint(8),
      19: () => p.uint(32),
      22: () => p.uint(16),
    };
    const f = one[type];
    if (!f) break;
    const values: unknown[] = [];
    for (let k = 0; k < n && p.left > 0; k++) values.push(f());
    out.push({ type, values });
  }
  return out;
}

/** PNG のフィルタ (0 なし・1 Sub・2 Up・3 Average・4 Paeth。PNG の仕様 §9) を戻す。各行の頭に 1 バイトのフィルタの番号がある */
function unfilterPng(d: Uint8Array, rowBytes: number, bpp: number, rows: number): Uint8Array {
  const out = new Uint8Array(rowBytes * rows);
  for (let j = 0; j < rows; j++) {
    const f = d[j * (rowBytes + 1)];
    const src = j * (rowBytes + 1) + 1;
    const o = j * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = d[src + i] ?? 0;
      const a = i >= bpp ? out[o + i - bpp] : 0;
      const b = j > 0 ? out[o - rowBytes + i] : 0;
      const c = i >= bpp && j > 0 ? out[o - rowBytes + i - bpp] : 0;
      let v = x;
      if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[o + i] = v & 255;
    }
  }
  return out;
}

interface Element {
  cls: number;
  id: number;
  data: Uint8Array;
}

/** 命令を順に取り出す (第 3 部 5.4)。壊れていれば途中まで */
function* elements(b: Uint8Array): Generator<Element> {
  let p = 0;
  while (p + 2 <= b.length) {
    const h = (b[p] << 8) | b[p + 1];
    p += 2;
    const cls = h >> 12;
    const id = (h >> 5) & 0x7f;
    let len = h & 0x1f;
    if (len !== 31) {
      if (p + len > b.length) return;
      yield { cls, id, data: b.subarray(p, p + len) };
      p += len + (len & 1);
      continue;
    }
    // 長い形: 分割された引数をつなぐ
    const parts: Uint8Array[] = [];
    for (;;) {
      if (p + 2 > b.length) return;
      const w = (b[p] << 8) | b[p + 1];
      p += 2;
      len = w & 0x7fff;
      if (p + len > b.length) return;
      parts.push(b.subarray(p, p + len));
      p += len + (len & 1);
      if (!(w & 0x8000)) break;
    }
    if (parts.length === 1) yield { cls, id, data: parts[0] };
    else {
      const all = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
      let o = 0;
      for (const x of parts) {
        all.set(x, o);
        o += x.length;
      }
      yield { cls, id, data: all };
    }
  }
}

/** CGM の 2 進符号化か (先頭が BEGIN METAFILE: 類 0・番号 1) */
export function isCgm(b: Uint8Array): boolean {
  return b.length >= 4 && ((b[0] << 8) | b[1]) >> 5 === 1;
}

/**
 * 最初の絵の大きさ (px) を、絵の本体を読まずに求める (imageInfo の cgmInfo 用)。cgmToSvg の大きさと同じになるように、
 * 記述子を cgmToSvg と同じ読み方で読む: 精度 (INTEGER PRECISION・REAL PRECISION・VDC TYPE・VDC INTEGER PRECISION・VDC REAL PRECISION。
 * 規格に無い値は前の値のまま)、SCALING MODE の倍率 (浮動小数点で書く。第 3 部 表 1 の注 10)、METAFILE DEFAULTS REPLACEMENT
 * (中の要素で既定値を置き換える)、BEGIN PICTURE で既定値に戻すこと。VDC EXTENT が無ければ、既定の範囲 (第 1 部 8 章) を使う。
 * 絵の本体 (BEGIN PICTURE BODY) が無いファイルは、VDC EXTENT が書かれていればその大きさ。大きさが決まらなければ undefined
 */
export function cgmPictureSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!isCgm(bytes)) return undefined;
  let defaults = initialState();
  let s = cloneState(defaults);
  let inPicture = false;
  const prec = (v: number, ok: number[], cur: number) => (ok.includes(v) ? v : cur);
  const realForm = (float: boolean, a: number, b: number, cur: RealForm): RealForm =>
    (float ? (a === 9 && b === 23) || (a === 12 && b === 52) : (a === 16 && b === 16) || (a === 32 && b === 32)) ? { float, a, b } : cur;
  const P8 = [8, 16, 24, 32];
  const size = (st: State, needExtent: boolean) => {
    if (needExtent && !st.vdcExtent) return undefined;
    const ext: [Pt, Pt] =
      st.vdcExtent ??
      (st.vdcType === 0
        ? [
            [0, 0],
            [32767, 32767],
          ]
        : [
            [0, 0],
            [1, 1],
          ]);
    const w = Math.abs(ext[1][0] - ext[0][0]);
    const h = Math.abs(ext[1][1] - ext[0][1]);
    // 幅か高さが 0 (か数でない) の範囲からは、大きさを決めない
    if (!(w > 0) || !(h > 0)) return undefined;
    if (st.scalingMetric && st.scalingMetric > 0) return { width: w * st.scalingMetric * PX_PER_MM, height: h * st.scalingMetric * PX_PER_MM };
    return { width: ABSTRACT_WIDTH, height: (ABSTRACT_WIDTH * h) / w };
  };
  /** 大きさに関わる要素だけを読む (cgmToSvg の process と同じ読み方) */
  const apply = (el: Element, st: State, inMdr: boolean) => {
    const p = new Params(el.data, st);
    const { cls, id } = el;
    if (cls === 1) {
      if (id === 3) st.vdcType = p.E() === 1 ? 1 : 0;
      else if (id === 4) st.intPrec = prec(p.I(), P8, st.intPrec);
      else if (id === 5) {
        const f = p.E();
        const a = p.I();
        const b = p.I();
        st.realForm = realForm(f === 0, a, b, st.realForm);
      } else if (id === 12 && !inMdr) {
        for (const sub of elements(el.data)) apply(sub, defaults, true);
        s = cloneState(defaults);
      }
    } else if (cls === 2) {
      if (id === 1) {
        const m = p.E();
        const f = p.floatReal();
        st.scalingMetric = m === 1 ? f : undefined;
      } else if (id === 6) st.vdcExtent = [p.P(), p.P()];
    } else if (cls === 3) {
      if (id === 1) st.vdcIntPrec = prec(p.I(), [16, 24, 32], st.vdcIntPrec);
      else if (id === 2) {
        const f = p.E();
        const a = p.I();
        const b = p.I();
        st.vdcRealForm = realForm(f === 0, a, b, st.vdcRealForm);
      }
    }
  };
  for (const el of elements(bytes)) {
    if (el.cls === 0) {
      if (el.id === 3) {
        // BEGIN PICTURE: 既定値に戻す
        s = cloneState(defaults);
        inPicture = true;
      } else if (el.id === 4) return size(s, false); // BEGIN PICTURE BODY: 絵の大きさが決まる
      else if (el.id === 5 || el.id === 2) break; // END PICTURE・END METAFILE
      continue;
    }
    apply(el, inPicture ? s : defaults, false);
    if (!inPicture && el.cls === 1) s = cloneState(defaults);
  }
  return size(s, true);
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const num = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1000) / 1000));
const hex = (c: Rgb) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

/** 要素の名前 (警告用。第 3 部 附属書 C の名前の一部) */
function elementName(cls: number, id: number): string {
  return `${cls},${id}`;
}

/** CGM の最初の絵を SVG にする。CGM でなければ undefined */
export function cgmToSvg(bytes: Uint8Array): CgmResult | undefined {
  if (!isCgm(bytes)) return undefined;
  let defaults = initialState();
  let s = cloneState(defaults);
  const warnings = new Set<string>();
  const warn = (m: string) => warnings.add(m);
  let inPicture = false;
  /** BEGIN PICTURE BODY の後 (背景色は BEGIN PICTURE BODY で決まり、絵の本体の色番号 0 の定義では変わらない。第 1 部 7.7.34) */
  let inBody = false;
  let pictureDone = false;
  let body: string[] = [];
  let count = 0;
  let W = ABSTRACT_WIDTH;
  let H = ABSTRACT_WIDTH;
  let ext: [Pt, Pt] = [
    [0, 0],
    [32767, 32767],
  ];
  // 書きかけの文字列 (TEXT・RESTRICTED TEXT の 'not final' と APPEND TEXT)
  let pendingText: { pos: Pt; box?: [number, number]; str: string } | undefined;
  let clipSeq = 0;
  let clipId: string | undefined;
  const defs: string[] = [];

  const defaultExtent = (st: State): [Pt, Pt] =>
    st.vdcExtent ??
    (st.vdcType === 0
      ? [
          [0, 0],
          [32767, 32767],
        ]
      : [
          [0, 0],
          [1, 1],
        ]);

  // ── 座標の写し (VDC → SVG の px) ──
  const X = (x: number) => ((x - ext[0][0]) / (ext[1][0] - ext[0][0])) * W;
  const Y = (y: number) => ((ext[1][1] - y) / (ext[1][1] - ext[0][1])) * H;
  const map = (p: Pt): Pt => [X(p[0]), Y(p[1])];
  /** VDC の向き (ベクトル) を SVG の向きにする */
  const mapVec = (v: Pt): Pt => [(v[0] / (ext[1][0] - ext[0][0])) * W, (-v[1] / (ext[1][1] - ext[0][1])) * H];
  /** VDC の長さ (向きによらない大きさ) を px にする (縦横の倍率の平均) */
  const vdcLen = (v: number) => Math.abs(v) * (W / Math.abs(ext[1][0] - ext[0][0]) + H / Math.abs(ext[1][1] - ext[0][1])) / 2;
  /** 既定の VDC EXTENT の長い辺 (幅・大きさの既定値の基準。第 1 部 8 章) */
  const longSide = () => {
    const e = defaultExtent(defaults);
    return Math.max(Math.abs(e[1][0] - e[0][0]), Math.abs(e[1][1] - e[0][1]));
  };
  /** 幅・大きさを px にする (第 1 部 6.7.5) */
  const sizePx = (mode: SpecMode, v: number, nominal: number, defAbs: number) => {
    if (mode === 0) return vdcLen(Number.isNaN(v) ? defAbs * longSide() : v);
    if (mode === 1) return v * nominal;
    if (mode === 2) return v * W; // 既定の表示面の幅に対する割合
    return v * PX_PER_MM;
  };
  const lineWidthPx = () => sizePx(s.lineWidthMode, s.lineWidth[s.lineWidthMode], NOMINAL_LINE_WIDTH, 0.001);
  const edgeWidthPx = () => sizePx(s.edgeWidthMode, s.edgeWidth[s.edgeWidthMode], NOMINAL_LINE_WIDTH, 0.001);

  const colourOf = (c: Colour): Rgb => {
    if ('rgb' in c) return c.rgb;
    // 直接色の流儀 (direct) で色番号のままの色は、まだ決められていない既定の色: 表示装置しだいの前景色 (第 1 部 8 章。
    // 線・印・字・塗り・辺の色の既定値は、indexed なら 1、direct なら前景色)
    if (s.colourSelection === 1) return DEVICE_FOREGROUND;
    const t = s.colourTable.get(c.index);
    if (t) return t;
    return c.index === 0 ? (s.background ?? DEVICE_BACKGROUND) : DEVICE_FOREGROUND;
  };

  /** 色の不透明度: 直接色の a か色表の不透明度 (色の型 6・8) に、ESCAPE 45 の不透明度を掛けたもの */
  const alphaOf = (c: Colour): number => {
    const a = 'rgb' in c ? (c.a ?? 1) : s.colourSelection === 0 ? (s.colourTableAlpha.get(c.index) ?? 1) : 1;
    return a * s.alpha;
  };
  /** 塗り・線の色の属性 (不透明度が 1 未満なら fill-opacity・stroke-opacity も) */
  const paint = (kind: 'fill' | 'stroke', c: Colour) => {
    const a = alphaOf(c);
    return `${kind}="${hex(colourOf(c))}"${a < 1 ? ` ${kind}-opacity="${num(a)}"` : ''}`;
  };

  /**
   * 束ね表 (第 1 部 6.7.1・7.7.35): ASPECT SOURCE FLAGS が 'bundled' の見た目は、束ねの番号 (LINE BUNDLE INDEX など) の表の値を使う。
   * 表に無い番号の中身は処理系しだい: 個別の値 (その時の LINE TYPE など) を使う。図形を描く間だけ、状態を置き換える
   */
  const resolveBundles = (st: State): State => {
    const a = st.asf;
    if (!a.some(Boolean)) return st;
    const r: State = { ...st, lineWidth: [...st.lineWidth], markerSize: [...st.markerSize], edgeWidth: [...st.edgeWidth] };
    const get = <T,>(m: Map<number, T>, idx: number, what: string): T | undefined => {
      const b = m.get(idx);
      if (!b) warn(`${what}の束ね表の ${idx} 番が定められていないので、個別の値で描きます`);
      return b;
    };
    if (a[0] || a[1] || a[2]) {
      const b = get(st.bundles.line, st.lineBundle, '線');
      if (b) {
        if (a[0]) r.lineType = b.type;
        if (a[1]) {
          r.lineWidthMode = b.mode;
          r.lineWidth[b.mode] = b.width;
        }
        if (a[2]) r.lineColour = b.colour;
      }
    }
    if (a[3] || a[4] || a[5]) {
      const b = get(st.bundles.marker, st.markerBundle, '印');
      if (b) {
        if (a[3]) r.markerType = b.type;
        if (a[4]) {
          r.markerSizeMode = b.mode;
          r.markerSize[b.mode] = b.size;
        }
        if (a[5]) r.markerColour = b.colour;
      }
    }
    if (a[6] || a[7] || a[8] || a[9] || a[10]) {
      const b = get(st.bundles.text, st.textBundle, '字');
      if (b) {
        if (a[6]) r.textFont = b.font;
        if (a[7]) r.textPrecision = b.precision;
        if (a[8]) r.charExpansion = b.expansion;
        if (a[9]) r.charSpacing = b.spacing;
        if (a[10]) r.textColour = b.colour;
      }
    }
    if (a[11] || a[12] || a[13] || a[14]) {
      const b = get(st.bundles.fill, st.fillBundle, '塗り');
      if (b) {
        if (a[11]) r.interiorStyle = b.style;
        if (a[12]) r.fillColour = b.colour;
        if (a[13]) r.hatchIndex = b.hatch;
        if (a[14]) r.patternIndex = b.pattern;
      }
    }
    if (a[15] || a[16] || a[17]) {
      const b = get(st.bundles.edge, st.edgeBundle, '辺');
      if (b) {
        if (a[15]) r.edgeType = b.type;
        if (a[16]) {
          r.edgeWidthMode = b.mode;
          r.edgeWidth[b.mode] = b.width;
        }
        if (a[17]) r.edgeColour = b.colour;
      }
    }
    return r;
  };
  const withBundles = (f: () => void) => {
    const saved = s;
    s = resolveBundles(s);
    if (s === saved) return f();
    try {
      f();
    } finally {
      s = saved;
    }
  };

  /** 線種 (1 実線・2 破線・3 点線・4 一点鎖線・5 二点鎖線。第 1 部 7.7.2)。線と隙間の長さは処理系しだいなので、線の太さの倍数で決める */
  const dashOf = (type: number, w: number): string | undefined => {
    const u = Math.max(w, 1);
    const def = s.lineTypeDefs.get(type);
    if (def) {
      // LINE AND EDGE TYPE DEFINITION (第 1 部 7.4.17): 線・隙間の長さを、和が 1 周期の長さになるように比で配る。
      // 周期の単位は定義した時の LINE WIDTH SPECIFICATION MODE (scaled は処理系しだい: 線の太さの倍数とする)。長さ 0 の線は点 (線の太さの長さ)
      const sum = def.dashes.reduce((a, v) => a + v, 0);
      if (def.dashes.length < 2 || !(sum > 0)) return undefined;
      const cycle = def.mode === 0 ? vdcLen(def.repeat) : def.mode === 1 ? def.repeat * u : def.mode === 2 ? def.repeat * W : def.repeat * PX_PER_MM;
      const list = def.dashes.map((v, k) => (k % 2 === 0 && v === 0 ? Math.max(w, 0.5) : (v / sum) * cycle));
      // 数が奇数なら、最後の線の後に長さ 0 の隙間を足す (次の周期の最初の線に続く。SVG は奇数の並びを 2 回繰り返して線と隙間が入れ替わるため)
      if (list.length % 2) list.push(0);
      return list.map(num).join(' ');
    }
    const pat: Record<number, number[]> = { 2: [6, 3], 3: [1, 3], 4: [6, 3, 1, 3], 5: [6, 3, 1, 3, 1, 3] };
    const p = pat[type];
    return p ? p.map((v) => num(v * u)).join(' ') : undefined;
  };
  const capOf = (c: number) => (c === 3 ? 'round' : c === 4 ? 'square' : 'butt');
  const joinOf = (j: number) => (j === 3 ? 'round' : j === 4 ? 'bevel' : 'miter');

  /**
   * fixed: 太さが表示装置の上の大きさ (scaled = 基準の太さの倍数、mm。第 1 部 6.7.5)。絵を拡大縮小しても太さを変えない
   * (vector-effect="non-scaling-stroke"。拡大した絵の線も、本来の太さのまま)
   */
  const strokeAttrs = (colour: Colour, w: number, type: number, cap: number, join: number, fixed = false, offset = 0, dashOverride?: string) => {
    const d = dashOverride ?? dashOf(type, w);
    // LINE TYPE INITIAL OFFSET (第 1 部 7.7.40): 線種の 1 周期に対する割合だけ、周期の中へ進んだところから描き始める
    const cycle = d ? d.split(' ').reduce((a, v) => a + Number(v), 0) : 0;
    const off = d && offset > 0 && cycle > 0 ? ` stroke-dashoffset="${num((offset % 1) * cycle)}"` : '';
    // MITRE LIMIT (第 1 部 7.5.15): つなぎが mitre (2) のときと、指定なし (1) で MITRE LIMIT を変えたときに書く
    // (指定なしのつなぎで既定の 32767 のままなら、SVG の既定の 4 に任せる)。1 未満は SVG で使えないので 1 にする
    const ml = join === 2 || (join === 1 && s.mitreLimit !== 32767) ? ` stroke-miterlimit="${num(Math.max(1, s.mitreLimit))}"` : '';
    return `fill="none" ${paint('stroke', colour)} stroke-width="${num(w)}" stroke-linecap="${capOf(cap)}" stroke-linejoin="${joinOf(join)}"${ml}${d ? ` stroke-dasharray="${d}"` : ''}${off}${fixed ? ' vector-effect="non-scaling-stroke"' : ''}`;
  };
  const fixedMode = (m: SpecMode) => m === 1 || m === 3;
  /** 経路を、命令ごとの区間 (始めの点と命令) に分ける (M・L・C・Q・Z の絶対座標だけ) */
  const pathParts = (d: string): Array<{ from: string[]; cmd: string; args: string[] }> => {
    const toks = d.match(/[MLCQZ]|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) ?? [];
    const out: Array<{ from: string[]; cmd: string; args: string[] }> = [];
    let cur: string[] = ['0', '0'];
    let start = cur;
    for (let i = 0; i < toks.length; ) {
      const c = toks[i++];
      const n = c === 'C' ? 6 : c === 'Q' ? 4 : c === 'Z' ? 0 : 2;
      const a = toks.slice(i, i + n);
      i += n;
      if (c === 'M') {
        cur = start = a;
        continue;
      }
      if (c === 'Z') {
        out.push({ from: cur, cmd: 'L', args: start });
        cur = start;
        continue;
      }
      out.push({ from: cur, cmd: c, args: a });
      cur = a.slice(-2);
    }
    return out;
  };
  /** 区間の長さ (曲線は 16 の折れ線で測る) */
  const partLength = (q: { from: string[]; cmd: string; args: string[] }) => {
    const v = [...q.from, ...q.args].map(Number);
    const pt = (t: number): Pt => {
      const u = 1 - t;
      if (q.cmd === 'C') return [u * u * u * v[0] + 3 * u * u * t * v[2] + 3 * u * t * t * v[4] + t * t * t * v[6], u * u * u * v[1] + 3 * u * u * t * v[3] + 3 * u * t * t * v[5] + t * t * t * v[7]];
      if (q.cmd === 'Q') return [u * u * v[0] + 2 * u * t * v[2] + t * t * v[4], u * u * v[1] + 2 * u * t * v[3] + t * t * v[5]];
      return [v[0] + (v[2] - v[0]) * t, v[1] + (v[3] - v[1]) * t];
    };
    const n = q.cmd === 'L' ? 1 : 16;
    let len = 0;
    for (let k = 1; k <= n; k++) {
      const a = pt((k - 1) / n);
      const b = pt(k / n);
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return len;
  };
  /** LINE TYPE CONTINUATION の restart: 頂点ごとに線種を始め直す (区間ごとに新しい部分経路にする。SVG の破線は部分経路ごとに始まる) */
  const restartAtVertices = (d: string) => pathParts(d).map((q) => `M${q.from[0]} ${q.from[1]}${q.cmd}${q.args.join(' ')}`).join('');
  /**
   * LINE TYPE CONTINUATION の adaptive continue: 頂点 (と始めと終わりの点) を必ず描く。区間ごとに、線種を伸び縮みさせて、
   * 区間の長さが「周期の整数倍 + 最初の線の長さ」になるようにする (区間の始めと終わりが線の上に来る)
   */
  const adaptiveDash = (d: string, dash: string, vertices: boolean): Array<[string, string]> => {
    const list = dash.split(' ').map(Number);
    const cycle = list.reduce((a, v) => a + v, 0);
    const d0 = list[0] ?? 0;
    const parts = pathParts(d);
    const groups = vertices ? parts.map((q) => [q]) : [parts];
    return groups
      .filter((g) => g.length)
      .map((g) => {
        const len = g.reduce((a, q) => a + partLength(q), 0);
        const n = Math.max(0, Math.round((len - d0) / cycle));
        const k = n * cycle + d0 > 0 ? len / (n * cycle + d0) : 1;
        const sd = `M${g[0].from[0]} ${g[0].from[1]}` + g.map((q) => `${q.cmd}${q.args.join(' ')}`).join('');
        return [sd, list.map((v) => num(v * k)).join(' ')] as [string, string];
      });
  };
  /** 線・辺の経路を描く要素 (LINE / EDGE TYPE CONTINUATION を掛ける)。vertices: 経路の点が要素の頂点か (円弧などを折れ線にした点でなく) */
  const strokeEl = (d: string, edge: boolean, vertices = true): string => {
    const w = edge ? edgeWidthPx() : lineWidthPx();
    const type = edge ? s.edgeType : s.lineType;
    const dash = dashOf(type, w);
    const cont = edge ? s.edgeCont : s.lineCont;
    const attrs = (dd?: string, offset = edge ? s.edgeOffset : s.lineOffset) =>
      edge ? strokeAttrs(s.edgeColour, w, type, s.edgeCap, s.edgeJoin, fixedMode(s.edgeWidthMode), offset, dd) : strokeAttrs(s.lineColour, w, type, s.lineCap, s.lineJoin, fixedMode(s.lineWidthMode), offset, dd);
    if (dash && cont === 3 && vertices) return `<path d="${restartAtVertices(d)}" ${attrs()}${clipAttr()}/>`;
    if (dash && cont === 4) return adaptiveDash(d, dash, vertices).map(([sd, dd]) => `<path d="${sd}" ${attrs(dd, 0)}${clipAttr()}/>`).join('');
    return `<path d="${d}" ${attrs()}${clipAttr()}/>`;
  };
  /** セグメントを写している間は、要素ごとの切り抜きを付けない (写した全体に、写した時の切り抜きを付ける) */
  let replayDepth = 0;
  let replayBudget = 200000;
  const clipAttr = () => (clipId && !replayDepth ? ` clip-path="url(#${clipId})"` : '');
  const pathOf = (pts: Pt[], close: boolean) => pts.map((p, k) => `${k ? 'L' : 'M'}${num(X(p[0]))} ${num(Y(p[1]))}`).join('') + (close ? 'Z' : '');

  /**
   * 出力の SVG の長さの勘定 (imageLimits.ts の metafileSvgBudget。画像の data: の中身と模様の中身は数えない: 画素の合計の上限で縛ってある)。
   * 上限を超えたら、警告を出して、その後は何も描かない (overflow)。COPY SEGMENT (24 バイト) は、点の多いセグメントを写すたびに全部を書くので、
   * 写した要素の数だけを数える上限 (replayBudget) では、33KB の CGM で SVG が数千万字 (18 秒・1.2GB) になった。
   * セグメントを写して描いた分は、写すたびに (emit で) 数えるので、写した量がそのまま勘定に入る
   */
  const svgBudget = metafileSvgBudget(bytes.length);
  let svgChars = 0;
  let overflow = false;
  const room = (n: number): boolean => {
    if (overflow) return false;
    if (svgChars + n > svgBudget) {
      overflow = true;
      warn(`CGM を SVG にした長さが上限 (${bytes.length} バイトのファイルでは ${svgBudget} 字) を超えるので、途中までを描きます`);
      return false;
    }
    svgChars += n;
    return true;
  };
  /** 要素を出す。uncounted は、el のうち勘定に入れない字数 (画像の中身、写したセグメントの中身 (写した時に数えてある)) */
  const emit = (el: string, uncounted = 0) => {
    if (!room(el.length - uncounted)) return;
    body.push(el);
    count++;
  };
  /** 定義 (defs) を足す。長さは勘定に入れるが、捨てはしない (引く側の要素が先に出ていることがあるので)。上限を超えた後は足さない */
  const addDef = (el: string, uncounted = 0) => {
    if (overflow) return;
    room(el.length - uncounted);
    defs.push(el);
  };

  /**
   * 閉じた図形 (BEGIN FIGURE 〜 END FIGURE。第 1 部 6.6.11)。中の線・塗りの要素は、その場では描かず、領域の境界 (regions) と
   * 辺 (edges: 辺の属性で描く部分) に集め、END FIGURE で、内側の塗り方に従って全体を 1 つの塗りとして描く
   */
  let fig: { regions: string[]; cur: string; edges: string[] } | null = null;
  /** CONNECTING EDGE (第 1 部 7.6.21): 前の線の要素の終わりの点から、次の点へ、辺を足す。閉じた図形の中で待っている間の始めの点 */
  let connectFrom: Pt | undefined;
  /** 閉じた図形の中の、前の線の要素の終わりの点と、いまの領域の始めの点 (px) */
  let figLast: Pt | undefined;
  let figStart: Pt | undefined;

  /**
   * セグメント (第 1 部 6.10): BEGIN SEGMENT 〜 END SEGMENT の要素を、始めの時の状態とともに覚えておき、COPY SEGMENT・geometric pattern で
   * 同じ要素をもう一度読んで描く (属性は定義した時のもの。INHERITANCE FILTER の既定 'segment')。
   * 絵の本体で定義したセグメントはその場でも描く。メタファイル記述子 (大域のセグメント)・絵の記述子で定義したものは、描かずに覚えるだけ
   */
  const segments = new Map<number, { els: Element[]; snap: State; xf?: number[] }>();
  let rec: { id: number; els: Element[]; snap: State; xf?: number[]; bodyStart: number; shown: boolean } | undefined;
  /** 2 行 3 列の行列 (a11 a12 a21 a22 a13 a23。x' = a11·x + a12·y + a13、y' = a21·x + a22·y + a23。第 3 部 表 11) を VDC の写しにする */
  const xfOf = (m: number[]) => (q: Pt): Pt => [m[0] * q[0] + m[1] * q[1] + m[4], m[2] * q[0] + m[3] * q[1] + m[5]];
  const fmtM = (m: number[]) => m.map((v) => String(Math.round(v * 10000) / 10000)).join(' ');
  /** セグメントの要素を読み直し、描いた SVG を返す (状態は元に戻す)。入れ子は 8 段まで (自分を写すセグメントで止まらなくならないように) */
  const replaySegment = (id: number, inheritFrom?: State): string | undefined => {
    const seg = segments.get(id);
    if (!seg) {
      warn(`セグメント ${id} は定義されていません`);
      return undefined;
    }
    // 入れ子は 8 段まで、読み直す要素は合わせて 20 万まで (互いに何度も写し合うセグメントで、止まらなくならないように)
    if (replayDepth >= 8 || replayBudget <= 0) {
      warn('COPY SEGMENT の入れ子が深すぎるか多すぎるので、途中から描きません');
      return '';
    }
    // SVG の長さの上限を超えた後は、写さない (写しても何も出ない。写す手間は、セグメントの大きさだけかかる)
    if (overflow) return '';
    const saved = { s, body, fig, pendingText, compound };
    s = cloneState(seg.snap);
    // INHERITANCE FILTER の 'state list' の属性: 写す時の値を使う (セグメントの中の属性の要素も、その属性を変えない)
    const keys = inheritFrom?.inherit ?? [];
    const inheritNow = () => {
      if (!inheritFrom) return;
      const dst = s as unknown as Record<string, unknown>;
      const src = inheritFrom as unknown as Record<string, unknown>;
      for (const k of keys) {
        if (k.startsWith('asf')) s.asf[Number(k.slice(3))] = inheritFrom.asf[Number(k.slice(3))];
        else dst[k] = Array.isArray(src[k]) ? [...(src[k] as unknown[])] : src[k];
      }
    };
    inheritNow();
    body = [];
    fig = null;
    compound = null;
    replayDepth++;
    try {
      for (const e of seg.els) {
        if (--replayBudget < 0) break;
        process(e, s, false);
        if (keys.length && (e.cls === 5 || e.cls === 3)) inheritNow();
      }
      return body.join('');
    } finally {
      replayDepth--;
      ({ s, body, fig, pendingText, compound } = saved);
    }
  };

  /**
   * タイルの並び (BEGIN TILE ARRAY 〜 END TILE ARRAY。第 1 部 7.2.16・6.6.5.2): タイル (TILE・BITONAL TILE) を、セルの進む向きに並べ、
   * 行の進む向きに折り返して 1 枚の画素にし、END TILE ARRAY で、中身のある範囲 (画像のずれと大きさ) を描く
   */
  let tiles:
    | { pos: Pt; pathDir: number; lineDir: number; ntp: number; ntl: number; ctp: number; ctl: number; csp: number; csl: number; offp: number; offl: number; ncp: number; ncl: number; rgba: Uint8Array; next: number }
    | undefined;
  /** 開いている領域を閉じる (閉じる点へ戻る暗黙の境界は、Z で表す) */
  const closeRegion = () => {
    if (fig?.cur) fig.regions.push(fig.cur + 'Z');
    if (fig) fig.cur = '';
    connectFrom = undefined;
    figLast = undefined;
  };
  /**
   * 複合線・複合の文字の経路 (BEGIN COMPOUND LINE 〜 END COMPOUND LINE・BEGIN COMPOUND TEXT PATH 〜 END。第 1 部 6.6.1.2・6.7.8):
   * 中の線の要素をつないで 1 本の経路にする (続いていない要素の間は直線でつなぐ)。複合線は END で 1 本の線として描き、文字の経路は描かずに覚える
   */
  let compound: { text: boolean; d: string; vertices: boolean } | null = null;
  /** 線の要素を描く。閉じた図形の中では、領域の境界に足す (前の要素の終わりから、この要素の始めへ、暗黙の境界でつなぐ)。vertices は strokeEl と同じ */
  const line = (d: string, vertices = true) => {
    if (compound) {
      compound.d += compound.d ? d.replace(/^M/, 'L') : d;
      compound.vertices &&= vertices;
      return;
    }
    if (!fig) {
      emit(strokeEl(d, false, vertices));
      return;
    }
    const ends = pathEnds(d);
    if (ends) connectEdge(ends[0]);
    // 要素の中の切れ目 (DISJOINT POLYLINE の描かない部分など) も、暗黙の境界でつなぐ
    const joined = d.replace(/M/g, 'L');
    if (!fig.cur && ends) figStart = ends[0];
    fig.cur += fig.cur ? joined : 'M' + joined.slice(1);
    if (ends) figLast = ends[1];
    if (s.edgeVisible) fig.edges.push(strokeEl(d, true, vertices));
  };
  /** 経路 (M・L・C・Q の絶対座標だけ) の最初と最後の点 */
  const pathEnds = (d: string): [Pt, Pt] | undefined => {
    const n = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
    return n.length >= 2 ? [[n[0], n[1]], [n[n.length - 2], n[n.length - 1]]] : undefined;
  };
  /** CONNECTING EDGE の辺を足す (待っていれば。to は次の点 px) */
  const connectEdge = (to: Pt | undefined) => {
    if (!connectFrom || !to || !fig) return;
    if (s.edgeVisible) fig.edges.push(strokeEl(`M${num(connectFrom[0])} ${num(connectFrom[1])}L${num(to[0])} ${num(to[1])}`, true));
    connectFrom = undefined;
  };

  /** 塗りの領域を描く: 内側 (INTERIOR STYLE) と辺 (EDGE VISIBILITY)。d は SVG の経路。edges は辺として描く経路 (省略時は d、null なら辺を描かない) */
  const filled = (d: string, edges?: string | null, vertices = true) => {
    if (fig) {
      // 閉じた図形の中の塗りの要素: 開いている領域を閉じ、完全な領域として足す。辺はそのまま辺になる
      closeRegion();
      fig.regions.push(d);
      if (s.edgeVisible && edges !== null && (edges ?? d)) fig.edges.push(strokeEl(edges ?? d, true, vertices));
      return;
    }
    const st = s.interiorStyle;
    if (st === 1) emit(`<path d="${d}" ${paint('fill', s.fillColour)} fill-rule="evenodd" stroke="none"${clipAttr()}/>`);
    else if (st === 0) {
      // hollow: 塗らずに、境界を塗りの色で描く (線種・太さは処理系しだい: 実線・基準の太さ)
      emit(`<path d="${d}" ${strokeAttrs(s.fillColour, NOMINAL_LINE_WIDTH, 1, 1, 1, true)}${clipAttr()}/>`);
    } else if (st === 3) {
      // 模様の線。交差の定義 (HATCH STYLE DEFINITION の crosshatch) は、2 つの向きの模様を重ねる
      for (const id of hatchPatterns(s.hatchIndex, colourOf(s.fillColour))) emit(`<path d="${d}" fill="url(#${id})" fill-rule="evenodd" stroke="none"${clipAttr()}/>`);
    } else if (st === 4) {
      // empty: 内側は何も描かない
    } else if (st === 2 || st === 5) {
      const id = st === 2 ? tablePattern() : geometricPattern();
      if (id) emit(`<path d="${d}" fill="url(#${id})" fill-rule="evenodd" stroke="none"${clipAttr()}/>`);
      else {
        warn(`内側の塗り方 ${st === 2 ? 'pattern' : 'geometric pattern'} の模様が定められていないので、塗りの色で塗ります`);
        emit(`<path d="${d}" ${paint('fill', s.fillColour)} fill-rule="evenodd" stroke="none"${clipAttr()}/>`);
      }
    } else if (st === 6) {
      const g = s.interp ?? defaultInterp();
      if (g.style === 3) triangleFill(d, g);
      else emit(`<path d="${d}" fill="url(#${gradient(g)})" fill-rule="evenodd" stroke="none"${clipAttr()}/>`);
    } else {
      warn(`内側の塗り方 ${st} は塗りの色で塗ります`);
      emit(`<path d="${d}" ${paint('fill', s.fillColour)} fill-rule="evenodd" stroke="none"${clipAttr()}/>`);
    }
    if (s.edgeVisible && edges !== null && (edges ?? d)) emit(strokeEl(edges ?? d, true, vertices));
  };

  let gradSeq = 0;
  /**
   * 色の補間 (INTERPOLATED INTERIOR。第 1 部 7.7.43・6.7.4.3.2) を SVG のグラデーションにする。
   * 平行: 塗りの基準点 F から基準の点 F + v へ向かう線 L 上で、段の区切り (F からの距離 |v|×S_i) に色を置き、間を線形に補間する。L に垂直な線の上は同じ色、外側は端の色
   * 楕円: F を中心、(F からの) 2 つの共役半径の楕円を基準に、同心の楕円の上は同じ色
   * 三角形は triangleFill (画素で塗る)
   */
  const gradient = (g: NonNullable<State['interp']>) => {
    const F = fillRefPoint();
    // 基準の形の単位は INTERIOR STYLE SPECIFICATION MODE
    const g1 = interiorVec(g.geo[0] ?? 0, g.geo[1] ?? 0, s.interiorMode);
    const g2 = interiorVec(g.geo[2] ?? 0, g.geo[3] ?? 0, s.interiorMode);
    const id = `cgmg${gradSeq++}`;
    const cols = g.colours.map((c) => hex(colourOf(c)));
    const stops = [0, ...g.stages];
    const last = stops[stops.length - 1] || 1;
    const stopTags = stops.map((v, k) => `<stop offset="${num(v / last)}" stop-color="${cols[Math.min(k, cols.length - 1)] ?? '#000000'}"/>`).join('');
    if (g.style === 1) {
      const a = map(F);
      const b = map([F[0] + g1[0] * last, F[1] + g1[1] * last]);
      addDef(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}">${stopTags}</linearGradient>`);
    } else {
      // 単位円 (半径 last) を、2 つの共役半径で楕円に写す
      const c = map(F);
      const u = mapVec(g1);
      const v = mapVec(g2);
      addDef(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${num(last)}" gradientTransform="matrix(${[u[0], u[1], v[0], v[1], c[0], c[1]].map(num).join(' ')})">${stopTags}</radialGradient>`,
      );
    }
    return id;
  };

  /** INTERPOLATED INTERIOR の既定値 (第 1 部 8 章): 平行、基準は既定の VDC EXTENT、段は 1 つ (1.0)、色は背景色 (indexed なら 0 番) */
  const defaultInterp = (): NonNullable<State['interp']> => {
    const e = defaultExtent(defaults);
    const bgc: Colour = s.colourSelection === 1 ? { rgb: s.background ?? DEVICE_BACKGROUND } : { index: 0 };
    return { style: 1, geo: [e[1][0] - e[0][0], e[1][1] - e[0][1]], stages: [1], colours: [bgc, bgc] };
  };

  /** 塗りの基準点 (FILL REFERENCE POINT。既定は既定の VDC EXTENT の左下) */
  const fillRefPoint = (): Pt => {
    const e = defaultExtent(defaults);
    return s.fillRef ?? [Math.min(e[0][0], e[1][0]), Math.min(e[0][1], e[1][1])];
  };
  /**
   * 内側の大きさの指定 (INTERIOR STYLE SPECIFICATION MODE。第 1 部 6.7.5) の向き (x, y) を VDC の向きにする。
   * absolute は VDC のまま。ほかは表示装置の上の大きさ (x は右、y は上) なので、px にしてから VDC に戻す
   */
  const interiorVec = (x: number, y: number, mode: SpecMode): Pt => {
    if (mode === 0) return [x, y];
    const k = mode === 1 ? NOMINAL_LINE_WIDTH * 4 : mode === 2 ? W : PX_PER_MM;
    const sx = W / (ext[1][0] - ext[0][0]);
    const sy = H / (ext[1][1] - ext[0][1]);
    return [(x * k) / sx, (y * k) / sy];
  };
  /** VDC の 1 次の写し (x' = a·x + b·y + e、y' = c·x + d·y + f) を、SVG の px の行列 (matrix(a b c d e f)) にする */
  const svgMatrix = (f: (p: Pt) => Pt): number[] => {
    const inv = (q: Pt): Pt => [ext[0][0] + (q[0] / W) * (ext[1][0] - ext[0][0]), ext[1][1] - (q[1] / H) * (ext[1][1] - ext[0][1])];
    const o = map(f(inv([0, 0])));
    const ex = map(f(inv([1, 0])));
    const ey = map(f(inv([0, 1])));
    return [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]];
  };

  /** 画素 (RGBA) を、単位の正方形を行列 m で写した位置に置く <image> (PNG)。cells ならセルの境目をぼかさない (image-rendering: pixelated) */
  const imageEl = (rgba: Uint8Array, w: number, h: number, m: number[], cells = true) =>
    `<image x="0" y="0" width="1" height="1" preserveAspectRatio="none"${cells ? ' style="image-rendering:pixelated"' : ''} transform="matrix(${m.map((v) => String(Math.round(v * 10000) / 10000)).join(' ')})" href="data:image/png;base64,${base64(encodePngStored({ width: w, height: h, rgba }))}"/>`;

  /**
   * この文書で画素にできる残りの数 (imageLimits.ts の metafilePixelBudget: 合計の上限と、ファイルの大きさに応じた上限の小さい方)。
   * 足りなければ警告して false (その画像は描かない)
   */
  const pixelBudget = metafilePixelBudget(bytes.length);
  let pixelsLeft = pixelBudget;
  const takePixels = (n: number, what: string): boolean => {
    if (n > pixelsLeft) {
      warn(`${what} は、文書の画像の画素の合計が上限 (${bytes.length} バイトのファイルでは ${pixelBudget} 画素) を超えるので描きません`);
      return false;
    }
    pixelsLeft -= n;
    return true;
  };

  let patSeq = 0;
  /** PATTERN TABLE の定義の通し番号 (模様の中身を見分ける鍵に使う) */
  let patternTableSeq = 0;
  /**
   * PATTERN TABLE の模様で塗るたびに調べる「表の中の違う色の数」の合計の上限 (2,000 万。1 つ約 50 ナノ秒で、約 1 秒)。
   * 正当な模様の色は多くて数百 (色番号 8 ビットの表で 256) なので、数万回塗っても届かない
   */
  let patternWork = 20_000_000;
  /** geometric pattern のセグメントを写した結果の控え (セグメントの番号 → 写した SVG と、模様の中身の id)。セグメントを定義し直したら捨てる */
  const geoFrags = new Map<number, { frag: string; body?: string }>();
  /**
   * 模様の定義を、使うたびに書き出さない (IMG-19 (3))。中身 (セルの矩形・画像、geometric pattern のセグメントの図形) は、同じ中身ごとに 1 つの
   * pattern に書き (patternBodies: 中身 → id)、使う所は、それを href で引いて置き方 (位置・大きさ・patternTransform) だけを書いた pattern にする
   * (SVG 1.1 §13.3 の xlink:href・SVG 2 §14.3.4 の href: 引いた pattern の中身を受け継ぐ)。同じ中身・同じ置き方なら同じ pattern を使う
   * (patternUses: 中身の id と置き方 → id)。前は使うたびに中身ごと書いたので、14KB の CGM で SVG が 2.9 億字 (<rect> 410 万個) になった
   */
  const patternBodies = new Map<string, string>();
  const patternUses = new Map<string, string>();
  /**
   * 中身の pattern の id。key は中身を見分ける鍵 (中身の文字列そのもの、または中身を決める値)。新しい中身なら content() で作って定義を書き、
   * cost を画素の合計に数える (足りなければ undefined)
   */
  const patternBody = (key: string, content: () => string, cost: number, what: string): string | undefined => {
    let id = patternBodies.get(key);
    if (id) return id;
    if (!takePixels(cost, what)) return undefined;
    id = `cgmp${patSeq++}`;
    patternBodies.set(key, id);
    // 中身は SVG の長さの勘定に入れない (セルの矩形・画像は画素の合計 (cost) で、セグメントの図形は写した時に、数えてある)
    const inner = content();
    addDef(`<pattern id="${id}" patternUnits="userSpaceOnUse">${inner}</pattern>`, inner.length);
    return id;
  };
  /** 中身の pattern (body) を、置き方 (place: pattern の属性) で敷く pattern の id */
  const patternUse = (body: string, place: string): string => {
    const key = `${body}|${place}`;
    let id = patternUses.get(key);
    if (id) return id;
    id = `cgmp${patSeq++}`;
    patternUses.set(key, id);
    addDef(`<pattern id="${id}" href="#${body}" ${place}/>`);
    return id;
  };
  /**
   * 模様のセルを矩形で書くときの、1 セルの重み (画素の合計に数える数)。<rect> 1 つは約 70 字で、画素を PNG (圧縮しない形) の base64 で書くときの
   * 1 画素 (約 5.3 字) の 13 倍ほどなので、16 と数える (画素の合計の上限が、SVG の長さの上限としても同じ程度に効くように)
   */
  const RECT_CELL_WEIGHT = 16;
  /**
   * PATTERN TABLE の模様 (第 1 部 7.7.32・7.7.33): 塗りの基準点 F と、PATTERN SIZE の高さの向き h・幅の向き w の平行四辺形 (模様の箱) を
   * nx × ny のセルに分ける。色の (1, ny) が F のセル、第 1 の添字は w の向き、第 2 の添字は h の向きに減る (1 行目が箱の h の側)。箱を繰り返して敷く
   */
  const tablePattern = (): string | undefined => {
    const t = s.patternTable.get(s.patternIndex) ?? (s.patternIndex === 1 ? { nx: 1, ny: 1, uid: 0, palette: [s.colourSelection === 1 ? ({ rgb: DEVICE_FOREGROUND } as Colour) : { index: 1 }], cells: new Uint32Array(1) } : undefined);
    if (!t || t.nx < 1 || t.ny < 1 || t.nx * t.ny > MAX_PIXELS) return undefined;
    const box = patternBox();
    if (!box) return undefined;
    const cells = t.nx * t.ny;
    const rects = cells <= 4096;
    // セルの色 (いまの色の表で決める)。中身の鍵は、表の定義の通し番号と、表の中の違う色 (palette) を色にした並び (8 ビットに丸めた値) の
    // 要約 (色の表が変われば別の中身)。要約は 32 ビットの FNV-1a を 2 本 (2 本とも一致する別の並びは、まず起きない)。
    // 前は、塗るたびに全部のセルの色を調べて要約を作っていたので、セルの多い表で小さな図形をいくつも塗ると、手間が図形の数 × セルの数になった。
    // 違う色の数だけを調べ、その合計にも上限を置く (patternWork。超えたら、その後の模様の塗りは描かない)
    patternWork -= t.palette.length;
    if (patternWork < 0) {
      warn('PATTERN TABLE の模様の色を調べる手間が上限を超えたので、その後の模様の塗りは描きません');
      return undefined;
    }
    const pal = t.palette.map(colourOf);
    let h1 = 0x811c9dc5;
    let h2 = 0x9747b28c;
    for (const c of pal)
      for (let j = 0; j < 3; j++) {
        const v = Math.round(Math.min(1, Math.max(0, c[j])) * 255);
        h1 = Math.imul(h1 ^ v, 0x01000193);
        h2 = Math.imul((h2 ^ v) + 0x9e3779b9, 0x5bd1e995);
      }
    const key = `t${t.uid}:${t.nx}x${t.ny}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
    // 模様の中身の座標: 単位の正方形 (u: 幅の向き、t: 下向き = 高さの向きの逆)。(u, t) → F + u·w + (1 − t)·h
    const [F, wv, hv] = box;
    const o = map([F[0] + hv[0], F[1] + hv[1]]);
    const a = mapVec(wv);
    const c = mapVec([-hv[0], -hv[1]]);
    // セルの色の境目をはっきりさせるため、小さな模様はセルを矩形で描く (大きな模様は画像)
    const content = () => {
      if (rects) return Array.from(t.cells, (n, k) => `<rect x="${num((k % t.nx) / t.nx)}" y="${num(Math.floor(k / t.nx) / t.ny)}" width="${num(1 / t.nx + 1e-4)}" height="${num(1 / t.ny + 1e-4)}" fill="${hex(pal[n])}"/>`).join('');
      const rgba = new Uint8Array(cells * 4);
      const bytes4 = pal.map((c) => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]);
      for (let k = 0; k < cells; k++) {
        const c = bytes4[t.cells[k]];
        rgba[k * 4] = c[0];
        rgba[k * 4 + 1] = c[1];
        rgba[k * 4 + 2] = c[2];
        rgba[k * 4 + 3] = 255;
      }
      return `<image x="0" y="0" width="1" height="1" preserveAspectRatio="none" style="image-rendering:pixelated" href="data:image/png;base64,${base64(encodePngStored({ width: t.nx, height: t.ny, rgba }))}"/>`;
    };
    // 中身は、新しい色の並びのときだけ書き、画素の合計に数える
    const body = patternBody(key, content, rects ? cells * RECT_CELL_WEIGHT : cells, 'PATTERN TABLE の模様');
    if (!body) return undefined;
    return patternUse(body, `patternUnits="userSpaceOnUse" x="0" y="0" width="1" height="1" patternTransform="matrix(${[a[0], a[1], c[0], c[1], o[0], o[1]].map((v) => String(Math.round(v * 10000) / 10000)).join(' ')})"`);
  };
  /** 模様の箱 (第 1 部 7.7.33): 基準点 F・幅の向き w・高さの向き h (VDC)。既定は (0, dy, dx, 0): 既定の VDC EXTENT の高さと幅 (absolute のとき) */
  const patternBox = (): [Pt, Pt, Pt] | undefined => {
    const e = defaultExtent(defaults);
    const ps = s.patternSize ?? (s.interiorMode === 0 ? [0, Math.abs(e[1][1] - e[0][1]), Math.abs(e[1][0] - e[0][0]), 0] : [0, 1, 1, 0]);
    const hv = interiorVec(ps[0], ps[1], s.interiorMode);
    const wv = interiorVec(ps[2], ps[3], s.interiorMode);
    if (Math.abs(wv[0] * hv[1] - wv[1] * hv[0]) < 1e-12) return undefined;
    return [fillRefPoint(), wv, hv];
  };
  /**
   * geometric pattern (第 1 部 7.4.19): GEOMETRIC PATTERN DEFINITION のセグメントを、範囲 (2 点の矩形) で切り抜いて、模様の箱に写して敷く。
   * 範囲の左下が F、x の向きが幅の向き w、y の向きが高さの向き h に写る
   */
  const geometricPattern = (): string | undefined => {
    const gp = s.geoPatterns.get(s.patternIndex);
    const box = patternBox();
    if (!gp || !box) return undefined;
    // セグメントを写した結果は、セグメントごとに 1 度だけ作る (写す時の状態はセグメントの定義の時のもので、塗る時の状態に依らない)。
    // 前は塗るたびに写していたので、点の多いセグメントの模様で小さな図形をいくつも塗ると、手間が図形の数 × セグメントの大きさになった
    let geo = geoFrags.get(gp.seg);
    if (!geo) {
      const f = replaySegment(gp.seg);
      if (f === undefined) return undefined;
      geo = { frag: f };
      // 上限 (入れ子・写す数・SVG の長さ) で途中までになった結果は、控えない
      if (!overflow && replayBudget > 0) geoFrags.set(gp.seg, geo);
    }
    const frag = geo.frag;
    const [F, wv, hv] = box;
    const x0 = Math.min(gp.ext[0][0], gp.ext[1][0]);
    const x1 = Math.max(gp.ext[0][0], gp.ext[1][0]);
    const y0 = Math.min(gp.ext[0][1], gp.ext[1][1]);
    const y1 = Math.max(gp.ext[0][1], gp.ext[1][1]);
    if (!(x1 > x0 && y1 > y0)) return undefined;
    const B = (q: Pt): Pt => {
      const u = (q[0] - x0) / (x1 - x0);
      const v = (q[1] - y0) / (y1 - y0);
      return [F[0] + u * wv[0] + v * hv[0], F[1] + u * wv[1] + v * hv[1]];
    };
    // 模様の中身は絵の px の座標のまま描き、範囲の矩形 (px) を 1 つの区画にする
    const a = map([x0, y1]);
    const b = map([x1, y0]);
    const m = svgMatrix(B);
    // 中身 (セグメントの図形) は同じ図形ごとに 1 つ。画素ではないので数えない (図形の数はセグメントの定義の大きさまで)
    const body = geo.body ?? (geo.body = patternBody(`g${frag}`, () => frag, 0, 'GEOMETRIC PATTERN の模様'));
    if (!body) return undefined;
    return patternUse(
      body,
      `patternUnits="userSpaceOnUse" x="${num(Math.min(a[0], b[0]))}" y="${num(Math.min(a[1], b[1]))}" width="${num(Math.abs(b[0] - a[0]))}" height="${num(Math.abs(b[1] - a[1]))}" patternTransform="matrix(${m.map((v) => String(Math.round(v * 10000) / 10000)).join(' ')})"`,
    );
  };

  /**
   * 三角形の色の補間 (第 1 部 7.7.43・6.7.4.3.2): 塗りの基準点 F と、F からの 2 つのずれの点の 3 つの角に色を置き、その間を 1 次で補間する
   * (平面の上の 1 次の関数なので、三角形の外もそのまま延ばす)。SVG のグラデーションでは表せないので、図形の外接矩形を画素で塗り、図形で切り抜く
   */
  const triangleFill = (d: string, g: NonNullable<State['interp']>) => {
    const F = fillRefPoint();
    // 基準の形 (2 つのずれ) の単位は INTERIOR STYLE SPECIFICATION MODE
    const v1 = interiorVec(g.geo[0] ?? 0, g.geo[1] ?? 0, s.interiorMode);
    const v2 = interiorVec(g.geo[2] ?? 0, g.geo[3] ?? 0, s.interiorMode);
    const P = [map(F), map([F[0] + v1[0], F[1] + v1[1]]), map([F[0] + v2[0], F[1] + v2[1]])];
    const C = [0, 1, 2].map((k) => colourOf(g.colours[k] ?? { index: 1 }));
    const det = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    const nums = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
    if (Math.abs(det) < 1e-9 || nums.length < 2) {
      emit(`<path d="${d}" fill="${hex(C[0])}" fill-rule="evenodd" stroke="none"${clipAttr()}/>`);
      return;
    }
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k + 1 < nums.length; k += 2) {
      x0 = Math.min(x0, nums[k]);
      x1 = Math.max(x1, nums[k]);
      y0 = Math.min(y0, nums[k + 1]);
      y1 = Math.max(y1, nums[k + 1]);
    }
    const bw = Math.max(x1 - x0, 1e-6);
    const bh = Math.max(y1 - y0, 1e-6);
    // 画素の数: 長い辺を 128 画素 (色はなめらかに変わるので、これで足りる)
    const n = 128;
    const iw = Math.max(1, Math.round(bw >= bh ? n : (n * bw) / bh));
    const ih = Math.max(1, Math.round(bh >= bw ? n : (n * bh) / bw));
    // この画像も文書の画素の合計に数える (図形ごとに 1 枚できる)。上限を超えたら、最初の色の一色で塗る
    if (!takePixels(iw * ih, 'INTERPOLATED INTERIOR の色の変化')) {
      emit(`<path d="${d}" fill="${hex(C[0])}" fill-rule="evenodd" stroke="none"${clipAttr()}/>`);
      return;
    }
    const rgba = new Uint8Array(iw * ih * 4);
    for (let j = 0; j < ih; j++)
      for (let i = 0; i < iw; i++) {
        const x = x0 + ((i + 0.5) / iw) * bw;
        const y = y0 + ((j + 0.5) / ih) * bh;
        // 重心座標 (三角形の外では負や 1 超えもそのまま使う = 平面の 1 次の関数)
        const l1 = ((x - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (y - P[0][1])) / det;
        const l2 = ((P[1][0] - P[0][0]) * (y - P[0][1]) - (x - P[0][0]) * (P[1][1] - P[0][1])) / det;
        const l0 = 1 - l1 - l2;
        const o = (j * iw + i) * 4;
        for (let k = 0; k < 3; k++) rgba[o + k] = Math.round(Math.min(1, Math.max(0, l0 * C[0][k] + l1 * C[1][k] + l2 * C[2][k])) * 255);
        rgba[o + 3] = 255;
      }
    const cid = `cgmc${clipSeq++}`;
    addDef(`<clipPath id="${cid}"><path d="${d}" clip-rule="evenodd"/></clipPath>`);
    const img = imageEl(rgba, iw, ih, [bw, 0, 0, bh, x0, y0], false);
    emit(`<g${clipAttr()}><g clip-path="url(#${cid})">${img}</g></g>`, img.length);
  };

  const hatchIds = new Map<string, string>();
  /**
   * HATCH STYLE DEFINITION で定めた模様の線 (第 1 部 7.4.18): 向きのベクトルに平行な線を、間隔の並び (和が 1 周期の長さになる比) で引く。
   * 最初の線の中心は塗りの基準点。線の太さは間隔の 1 単位 (1 周期の長さ ÷ 間隔の和)。色は塗りの色。交差 (crosshatch) は 2 つ目の向きの線も引く
   */
  const hatchPatterns = (idx: number, c: Rgb): string[] => {
    const def = s.hatchDefs.get(idx);
    if (!def) return [hatchPattern(idx, c)];
    const sum = def.gaps.reduce((a, v) => a + v, 0);
    if (!(sum > 0) || !def.gaps.length) return [hatchPattern(1, c)];
    // 1 周期の長さ (px)。scaled は処理系しだい: 基準の太さの 24 倍とする
    const dutyPx = def.mode === 0 ? vdcLen(def.duty) : def.mode === 1 ? def.duty * NOMINAL_LINE_WIDTH * 24 : def.mode === 2 ? def.duty * W : def.duty * PX_PER_MM;
    if (!(dutyPx > 0)) return [hatchPattern(1, c)];
    const unit = dutyPx / sum;
    const F = map(fillRefPoint());
    const out: string[] = [];
    for (const k of def.cross ? [0, 1] : [0]) {
      const v: Pt = def.mode === 0 ? mapVec([def.dirs[2 * k], def.dirs[2 * k + 1]]) : [def.dirs[2 * k], -def.dirs[2 * k + 1]];
      if (!(Math.hypot(v[0], v[1]) > 0)) continue;
      const ang = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
      // 模様の座標: x は線の向き、y は線に垂直 (1 周期の高さ)。線は y = 各線の中心
      let y = 0;
      const lines: string[] = [];
      def.gaps.forEach((gap, i) => {
        const dash = dashOf(def.types[i] ?? 1, unit);
        for (const yy of [y, y + dutyPx]) lines.push(`<line x1="-1" y1="${num(yy)}" x2="${num(dutyPx + 1)}" y2="${num(yy)}" stroke="${hex(c)}" stroke-width="${num(unit)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
        y += gap * unit;
      });
      const id = `cgmh${hatchIds.size + out.length}x${patSeq++}`;
      addDef(`<pattern id="${id}" patternUnits="userSpaceOnUse" x="0" y="0" width="${num(dutyPx)}" height="${num(dutyPx)}" patternTransform="translate(${num(F[0])} ${num(F[1])}) rotate(${num(ang)})">${lines.join('')}</pattern>`);
      out.push(id);
    }
    return out.length ? out : [hatchPattern(1, c)];
  };
  /** 模様の線 (HATCH INDEX 1〜6。第 3 部 表 8 の 24 番)。線の間隔と太さは処理系しだい */
  const hatchPattern = (idx: number, c: Rgb) => {
    const key = `${idx}:${hex(c)}`;
    let id = hatchIds.get(key);
    if (id) return id;
    id = `cgmh${hatchIds.size}`;
    hatchIds.set(key, id);
    const g = 6;
    const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${hex(c)}" stroke-width="0.6"/>`;
    const parts: string[] = [];
    if (idx === 1 || idx === 5) parts.push(line(0, g / 2, g, g / 2));
    if (idx === 2 || idx === 5) parts.push(line(g / 2, 0, g / 2, g));
    if (idx === 3 || idx === 6) parts.push(line(0, g, g, 0));
    if (idx === 4 || idx === 6) parts.push(line(0, 0, g, g));
    if (!parts.length) parts.push(line(0, g / 2, g, g / 2));
    addDef(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${g}" height="${g}">${parts.join('')}</pattern>`);
    return id;
  };

  /** 円・楕円の弧の点列 (VDC)。中心 c、t の範囲 [t0, t1]、点 f(t) */
  const arcPoints = (f: (t: number) => Pt, t0: number, t1: number): Pt[] => {
    const n = Math.max(8, Math.ceil((Math.abs(t1 - t0) / (2 * Math.PI)) * 128));
    const out: Pt[] = [];
    for (let k = 0; k <= n; k++) out.push(f(t0 + ((t1 - t0) * k) / n));
    return out;
  };
  /** 始めの角度から正の向きに終わりの角度まで (同じ向きなら一周。第 1 部 附属書 D の推奨) */
  const sweep = (a0: number, a1: number) => {
    let d = a1 - a0;
    while (d <= 1e-12) d += 2 * Math.PI;
    return a0 + d;
  };

  let textPathSeq = 0;
  /** 文字列を描く (TEXT・RESTRICTED TEXT)。box は RESTRICTED TEXT の幅と高さ (VDC) */
  const drawText = (pos: Pt, text: string, box?: [number, number]) => {
    // 文字の符号を、CHARACTER SET LIST・CHARACTER SET INDEX の文字集合で読む
    let str = decodeText(s, text);
    if (!str) return;
    const e = defaultExtent(defaults);
    const dy = Math.abs(e[1][1] - e[0][1]);
    let h = s.charHeight ?? longSide() / 100;
    // RESTRICTED TEXT TYPE (第 1 部 6.7.3.2・7.7.42): 1 basic・2 boxed-cap・3 boxed-all・4 isotropic-cap・5 isotropic-all・6 justified
    const rt = box ? s.restrictedType : 1;
    /** 書体の上端から下端まで (BOTTOMLINE〜TOPLINE) を箱の高さに合わせる種類 */
    const all = rt === 3 || rt === 5;
    if (box && box[1] > 0) {
      // cap は基線から CAPLINE まで、all は BOTTOMLINE から TOPLINE まで (文字の高さの 1.5 倍とする) を箱の高さにする。
      // basic は文字の高さが箱の高さを超えるなら箱の高さに縮める (縦横の比は保つ。実現の方法は処理系しだい)。justified は高さを変えない
      if (rt === 2 || rt === 4) h = box[1];
      else if (all) h = box[1] / 1.5;
      else if (rt !== 6 && h > box[1]) h = box[1];
    }
    const [ux, uy, bx, by] = s.charOrientation ?? [0, dy, dy, 0];
    const ul = Math.hypot(ux, uy) || 1;
    // TEXT PATH (第 1 部 7.7.17): right は基準の向き、left はその逆、up は上の向き、down はその逆に字を進める
    const path = box && s.textPath >= 2 ? 0 : s.textPath;
    if (box && s.textPath >= 2) warn('RESTRICTED TEXT の TEXT PATH (up・down) は right で描きます');
    // 文字の局所座標 (x: 基準の向き、y: 上の向きの逆。単位は文字の高さに対する VDC) → SVG の行列 (第 1 部 7.7.16)
    const B = mapVec([(bx / ul) * s.charExpansion, (by / ul) * s.charExpansion]);
    const U = mapVec([ux / ul, uy / ul]);
    const P = map(pos);
    const fs = h / CAP_HEIGHT_EM;
    // 揃え (第 1 部 7.7.18): normal は、path が right なら left・base、left なら right・base、up なら centre・base、down なら centre・top
    const [ha, va, ch, cv] = s.textAlign;
    if (s.textPathMode === 1 || s.textPathMode === 2) {
      drawTextOnPath(str, h, U, ha, !!box);
      return;
    }
    if (path >= 2) {
      if (s.scores.length) warn('TEXT PATH が up・down の文字の TEXT SCORE TYPE は描きません');
      drawVerticalText(str, h, path === 3, B, U, map(pos), fs, ha, va, cv);
      return;
    }
    // left: 字を逆の順に並べた文字列を、右端を基準に置く (normal の横の揃えは right)
    if (path === 1) str = [...str].reverse().join('');
    const hh = path === 1 && ha === 0 ? 3 : ha;
    const anchor = hh === 2 ? 'middle' : hh === 3 ? 'end' : 'start';
    // 縦の揃え: 基線を、文字の位置から上の向きに up だけ動かす。top・bottom は書体の上端・下端 (処理系しだい: 文字の高さの 1.2 倍・0.3 倍とする)。
    // continuous は BOTTOMLINE (0) から TOPLINE (1) までの割合の位置を、文字の位置に合わせる
    let up = 0;
    if (va === 1) up = -h * 1.2;
    else if (va === 2) up = -h;
    else if (va === 3) up = -h / 2;
    else if (va === 5) up = h * 0.3;
    else if (va === 6) up = h * 0.3 - h * 1.5 * cv;
    let along = 0;
    let fit = '';
    let anchorAttr = anchor !== 'start' ? ` text-anchor="${anchor}"` : '';
    if (box) {
      // RESTRICTED TEXT: 揃えの基準は制限の箱。文字列は箱の左から置く。
      // basic は箱の幅を超えるときだけ横に縮め、boxed は箱の幅にちょうど合わせ (字を横に伸び縮み)、isotropic は箱を超えるときは縦横同じ比で縮め、
      // justified は字の間を空けて (詰めて) 箱の幅に合わせる
      const [bw, bh] = box;
      const boxBottom = va === 1 || va === 2 ? -bh : va === 3 ? -bh / 2 : va === 6 ? -bh * cv : 0;
      up = boxBottom + (all || va === 5 ? h * 0.3 : 0);
      // 局所座標の x の 1 単位は、基準の向きの VDC で |基準| / |上| × 拡大率 の長さ。箱の幅とずらしはその単位に直す
      const kx = (Math.hypot(bx, by) / ul) * s.charExpansion || 1;
      along = (ha === 2 ? -bw / 2 : ha === 3 ? -bw : ha === 4 ? -bw * ch : 0) / kx;
      anchorAttr = '';
      const len = num(bw / kx);
      fit =
        rt === 2 || rt === 3
          ? ` textLength="${len}" lengthAdjust="spacingAndGlyphs"`
          : rt === 4 || rt === 5
            ? ` data-max-length="${len}" data-fit="uniform"`
            : rt === 6
              ? ` textLength="${len}" lengthAdjust="spacing"`
              : ` data-max-length="${len}"`;
    }
    // 局所の原点を、揃えの分だけずらす (along は基準の向き、up は上の向き)
    const m = [B[0], B[1], -U[0], -U[1], P[0] + B[0] * along + U[0] * up, P[1] + B[1] * along + U[1] * up];
    const attrs = textAttrs(fs);
    const spacing = s.charSpacing ? ` letter-spacing="${num(s.charSpacing * h)}"` : '';
    // 切り抜きは外側の g に付ける (text の transform で、切り抜きの矩形まで写されないように)
    const el = `<text transform="matrix(${m.map(num).join(' ')})" x="0" y="0" ${attrs}${anchorAttr}${spacing}${fit}${scoreAttrs(path === 1)} xml:space="preserve">${esc(str)}</text>`;
    emit(clipId && !replayDepth ? `<g${clipAttr()}>${el}</g>` : el);
  };
  /**
   * TEXT SCORE TYPE (第 1 部 7.7.41) を SVG の text-decoration と data-kendot にする。right score は字の進む向きの右側
   * (right の path なら字の下 = 下線、left の path なら字の上)、left score はその逆、through score は字の中ほど、kendot は right score の側の点
   */
  const scoreAttrs = (reversed: boolean) => {
    if (!s.scores.length) return '';
    const on = (t: number) => s.scores.includes(t);
    const deco = [on(reversed ? 2 : 1) && 'underline', on(reversed ? 1 : 2) && 'overline', on(3) && 'line-through'].filter(Boolean);
    return `${deco.length ? ` text-decoration="${deco.join(' ')}"` : ''}${on(4) ? ` data-kendot="${reversed ? 'over' : 'true'}"` : ''}`;
  };
  /**
   * GENERALIZED TEXT PATH MODE (第 1 部 6.5.5・6.7.8) が non-tangential・axis-tangential の文字列: 最後の複合の文字の経路 (無ければ既定:
   * 既定の VDC EXTENT の下の辺) に沿って、字の位置を弧の長さで置く (SVG の textPath)。axis-tangential は字を経路の接線の向きに回し、
   * non-tangential は回さない。経路の終わりを超える字は、終わりの接線の向きの直線の上に置く。横の揃えは経路の始め・真ん中・終わり
   */
  const drawTextOnPath = (str: string, h: number, U: Pt, ha: number, boxed: boolean) => {
    if (boxed) warn('GENERALIZED TEXT PATH MODE の RESTRICTED TEXT は、箱に合わせずに経路に沿って描きます');
    const e = defaultExtent(defaults);
    const d = s.textPathD ?? pathOf([[Math.min(e[0][0], e[1][0]), Math.min(e[0][1], e[1][1])], [Math.max(e[0][0], e[1][0]), Math.min(e[0][1], e[1][1])]], false);
    const id = `cgmtp${textPathSeq++}`;
    addDef(`<path id="${id}" d="${d}"/>`);
    // 局所の単位 (VDC) を px にする倍率: 上の向きの長さ
    const k = Math.hypot(U[0], U[1]) || 1;
    const fs = (h / CAP_HEIGHT_EM) * k;
    const font = fontFamilyOf(s.fonts[s.textFont - 1] ?? 'Helvetica');
    const anchor = ha === 2 ? ' text-anchor="middle"' : ha === 3 ? ' text-anchor="end"' : '';
    const offset = ha === 2 ? '50%' : ha === 3 ? '100%' : '0';
    const spacing = s.charSpacing ? ` letter-spacing="${num(s.charSpacing * h * k)}"` : '';
    const el = `<text font-family="${font.family}"${font.bold ? ' font-weight="bold"' : ''}${font.italic ? ' font-style="italic"' : ''} font-size="${num(fs)}" ${paint('fill', s.textColour)}${anchor}${spacing} xml:space="preserve"><textPath href="#${id}" startOffset="${offset}" data-extend="true"${s.textPathMode === 1 ? ' data-rotate="none"' : ''}>${esc(str)}</textPath></text>`;
    if (s.scores.length) warn('GENERALIZED TEXT PATH MODE の文字の TEXT SCORE TYPE は描きません');
    emit(clipId && !replayDepth ? `<g${clipAttr()}>${el}</g>` : el);
  };
  /** 文字の属性 (書体・大きさ・色) */
  const textAttrs = (fs: number) => {
    const font = fontFamilyOf(s.fonts[s.textFont - 1] ?? 'Helvetica');
    return `font-family="${font.family}"${font.bold ? ' font-weight="bold"' : ''}${font.italic ? ' font-style="italic"' : ''} font-size="${num(fs)}" ${paint('fill', s.textColour)}`;
  };
  /**
   * TEXT PATH が up・down の文字列: 字を 1 字ずつ、上の向き (down はその逆) に、字の送り (書体の大きさ + CHARACTER SPACING × 文字の高さ) で積む。
   * 横の揃えは各字に (normal は centre)、縦の揃えは字の列全体に掛ける (normal は up なら base = 最初の字の基線、down なら top = 最初の字の上端)
   */
  const drawVerticalText = (str: string, h: number, down: boolean, B: Pt, U: Pt, P: Pt, fs: number, ha: number, va: number, cv: number) => {
    const chars = [...str];
    const n = chars.length;
    const adv = fs + s.charSpacing * h;
    // 上の向きの位置 (VDC): 字 k の基線
    const ys = chars.map((_, k) => (down ? -k : k) * adv);
    const last = ys[n - 1];
    const top = down ? h * 1.2 : last + h * 1.2;
    const cap = down ? h : last + h;
    const base = down ? last : 0;
    const bottom = (down ? last : 0) - h * 0.3;
    const v = va === 0 ? (down ? 1 : 4) : va;
    const ref = v === 1 ? top : v === 2 ? cap : v === 3 ? (base + cap) / 2 : v === 5 ? bottom : v === 6 ? bottom + (top - bottom) * cv : base;
    const anchor = ha === 1 ? 'start' : ha === 3 ? 'end' : 'middle';
    const m = [B[0], B[1], -U[0], -U[1], P[0], P[1]];
    const parts = chars.map((c, k) => `<text transform="matrix(${m.map(num).join(' ')})" x="0" y="${num(-(ys[k] - ref))}" ${textAttrs(fs)} text-anchor="${anchor}" xml:space="preserve">${esc(c)}</text>`);
    emit(`<g${clipAttr()}>${parts.join('')}</g>`);
  };

  // 精度は規格の値だけを受け付ける (ISO/IEC 8632-3 の表: 整数・索引・色の精度は 8・16・24・32、VDC の整数は 16・24・32、
  // 実数は (浮動 9,23)・(浮動 12,52)・(固定 16,16)・(固定 32,32) の 4 通り)。ほかの値 (0・負) は読み進められなくなるので、既定値のままにする
  const prec = (v: number, ok: number[], cur: number, what: string): number => {
    if (ok.includes(v)) return v;
    warn(`${what} ${v} は規格に無い値なので、${cur} のまま読みます`);
    return cur;
  };
  const realForm = (float: boolean, a: number, b: number, cur: State['realForm'], what: string): State['realForm'] => {
    if (float ? (a === 9 && b === 23) || (a === 12 && b === 52) : (a === 16 && b === 16) || (a === 32 && b === 32)) return { float, a, b };
    warn(`${what} (${a}, ${b}) は規格に無い値なので、前の値のまま読みます`);
    return cur;
  };
  const P8 = [8, 16, 24, 32];
  const process = (el: Element, st: State, inMdr: boolean) => {
    const p = new Params(el.data, st);
    const { cls, id } = el;
    const remaining = () => p.left > 0;
    switch (cls) {
      case 0: // 区切り
        if (id === 3 && !inMdr) {
          // BEGIN PICTURE: 既定値に戻す
          if (pictureDone) return 'stop';
          s = cloneState(defaults);
          inPicture = true;
          inBody = false;
          body = [];
        } else if (id === 4 && !inMdr) {
          // BEGIN PICTURE BODY: 絵の大きさと背景を決める
          ext = defaultExtent(s);
          const w = Math.abs(ext[1][0] - ext[0][0]) || 1;
          const h = Math.abs(ext[1][1] - ext[0][1]) || 1;
          if (s.scalingMetric && s.scalingMetric > 0) {
            W = w * s.scalingMetric * PX_PER_MM;
            H = h * s.scalingMetric * PX_PER_MM;
          } else {
            W = ABSTRACT_WIDTH;
            H = (ABSTRACT_WIDTH * h) / w;
          }
          inBody = true;
          // 背景色: BACKGROUND COLOUR か、絵の記述子・METAFILE DEFAULTS REPLACEMENT の色表の 0 番の、後に来た方 (第 1 部 7.4.7・7.7.34)
          const bg = s.background;
          if (bg) body.push(`<rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="${hex(bg)}"/>`);
          updateClip();
        } else if (id === 5 && !inMdr) {
          pictureDone = true;
          return 'stop';
        } else if (id === 8 && inPicture) {
          // BEGIN FIGURE
          fig = { regions: [], cur: '', edges: [] };
        } else if (id === 9 && fig) {
          // END FIGURE: 領域を閉じ、全体を内側の塗り方で塗ってから、辺を描く
          connectEdge(figStart);
          closeRegion();
          const f = fig;
          fig = null;
          if (f.regions.length) withBundles(() => filled(f.regions.join(''), null));
          for (const e of f.edges) emit(e);
        } else if (id === 6 && !inMdr && !replayDepth) {
          // BEGIN SEGMENT
          rec = { id: p.N(), els: [], snap: cloneState(st), bodyStart: body.length, shown: inBody };
        } else if (id === 7 && rec && !replayDepth) {
          // END SEGMENT: 覚える。絵の本体のセグメントに SEGMENT TRANSFORMATION があれば、その場で描いたものに掛ける
          segments.set(rec.id, { els: rec.els, snap: rec.snap, xf: rec.xf });
          geoFrags.clear();
          if (rec.shown && rec.xf) {
            const part = body.splice(rec.bodyStart);
            body.push(`<g transform="matrix(${fmtM(svgMatrix(xfOf(rec.xf)))})">${part.join('')}</g>`);
          }
          rec = undefined;
        } else if ((id === 15 || id === 17) && inBody) {
          // BEGIN COMPOUND LINE・BEGIN COMPOUND TEXT PATH
          compound = { text: id === 17, d: '', vertices: true };
        } else if ((id === 16 || id === 18) && compound) {
          // END COMPOUND LINE: つないだ経路を 1 本の線として描く。END COMPOUND TEXT PATH: 描かずに、文字の経路として覚える
          const c: { text: boolean; d: string; vertices: boolean } = compound;
          compound = null;
          if (c.text) st.textPathD = c.d || undefined;
          else if (c.d) withBundles(() => line(c.d, c.vertices));
        } else if (id === 19 && inBody) beginTileArray(p);
        else if (id === 20 && tiles) endTileArray();
        return;
      case 1: // メタファイル記述子
        if (id === 3) st.vdcType = p.E() === 1 ? 1 : 0;
        else if (id === 4) st.intPrec = prec(p.I(), P8, st.intPrec, 'INTEGER PRECISION');
        else if (id === 5) {
          const f = p.E();
          const a = p.I();
          const b = p.I();
          st.realForm = realForm(f === 0, a, b, st.realForm, 'REAL PRECISION');
        } else if (id === 6) st.indexPrec = prec(p.I(), P8, st.indexPrec, 'INDEX PRECISION');
        else if (id === 7) st.colourPrec = prec(p.I(), P8, st.colourPrec, 'COLOUR PRECISION');
        else if (id === 8) st.colourIndexPrec = prec(p.I(), P8, st.colourIndexPrec, 'COLOUR INDEX PRECISION');
        else if (id === 10) {
          if (rgbLike(st.colourModel) || st.colourModel === 4) {
            st.cvMin = p.CD();
            st.cvMax = p.CD();
          } else if (st.colourModel === 2 || st.colourModel === 3 || st.colourModel === 5) st.cvScale = [0, 1, 2, 3, 4, 5].map(() => p.R());
        } else if (id === 14) {
          // CHARACTER SET LIST: (種類, 指示の列の終わり) の並び
          st.charSets = [];
          while (p.left >= 16 + 8) st.charSets.push({ type: p.E(), tail: p.S() });
        } else if (id === 15) st.codingAnnouncer = p.E();
        else if (id === 20) {
          // COLOUR CALIBRATION: 選び方 (1 指定なし) と基準の白 (XYZ)。ほかの較正の値 (行列・表) は読まない
          const sel = p.IX();
          const w: [number, number, number] = [p.R(), p.R(), p.R()];
          if (sel >= 2 && w[1] > 0) st.white = [w[0] / w[1], 1, w[2] / w[1]];
          if (sel >= 3) warn('COLOUR CALIBRATION の行列と表は読まず、基準の白だけを使います');
        } else if (id === 12) {
          // METAFILE DEFAULTS REPLACEMENT: 中の要素で既定値を置き換える。中の MDR は読まない (入れ子にするものではない。
          // 入れ子を読むと、細工したファイルで深く再帰する)
          if (inMdr) return;
          for (const sub of elements(el.data)) process(sub, defaults, true);
          s = cloneState(defaults);
        } else if (id === 13) {
          st.fonts = [];
          while (remaining()) st.fonts.push(p.S());
        } else if (id === 16) st.namePrec = prec(p.I(), P8, st.namePrec, 'NAME PRECISION');
        else if (id === 19) st.colourModel = p.IX();
        return;
      case 2: // 絵の記述子
        if (id === 1) {
          const m = p.E();
          const f = p.floatReal();
          st.scalingMetric = m === 1 ? f : undefined;
        } else if (id === 2) st.colourSelection = p.E() === 1 ? 1 : 0;
        else if (id === 3) st.lineWidthMode = p.E() as SpecMode;
        else if (id === 4) st.markerSizeMode = p.E() as SpecMode;
        else if (id === 5) st.edgeWidthMode = p.E() as SpecMode;
        else if (id === 6) st.vdcExtent = [p.P(), p.P()];
        else if (id === 7) {
          // BACKGROUND COLOUR: 引数は常に直接色。色番号の流儀 (indexed) では、色番号 0 の初めの色も決める (第 1 部 7.4.7)
          st.background = toRgb(st, p.CD());
          if (st.colourSelection === 0) st.colourTable.set(0, st.background);
        }
        else if (id === 16) st.interiorMode = p.E() as SpecMode;
        else if (id === 17) {
          // LINE AND EDGE TYPE DEFINITION (第 1 部 7.4.17): 負の番号・1 周期の長さ (LINE WIDTH SPECIFICATION MODE の単位)・線と隙間の並び
          const idx = p.IX();
          const repeat = p.SS(st.lineWidthMode);
          const dashes: number[] = [];
          while (p.left >= st.intPrec) dashes.push(Math.max(0, p.I()));
          if (idx < 0 && dashes.length) st.lineTypeDefs.set(idx, { repeat, mode: st.lineWidthMode, dashes });
        } else if (id === 18) {
          // HATCH STYLE DEFINITION (第 1 部 7.4.18)
          const idx = p.IX();
          const cross = p.E() === 1;
          const dirs = [0, 1, 2, 3].map(() => p.SS(st.interiorMode));
          const duty = p.SS(st.interiorMode);
          const n = Math.max(0, Math.min(p.I(), 10000));
          const gaps: number[] = [];
          for (let k = 0; k < n && p.left > 0; k++) gaps.push(Math.max(0, p.I()));
          const types: number[] = [];
          for (let k = 0; k < n && p.left > 0; k++) types.push(p.IX());
          if (idx < 0) st.hatchDefs.set(idx, { cross, dirs, duty, gaps, types, mode: st.interiorMode });
        } else if (id === 11 || id === 15) {
          // LINE / EDGE REPRESENTATION (第 1 部 7.4.11・7.4.15): 番号・線種・太さ (その時の WIDTH SPECIFICATION MODE の単位)・色
          const idx = p.IX();
          const type = p.IX();
          const mode = id === 11 ? st.lineWidthMode : st.edgeWidthMode;
          const width = p.SS(mode);
          const colour = p.CO();
          (id === 11 ? st.bundles.line : st.bundles.edge).set(idx, { type, width, mode, colour });
        } else if (id === 12) {
          // MARKER REPRESENTATION (第 1 部 7.4.12)
          const idx = p.IX();
          const type = p.IX();
          const mode = st.markerSizeMode;
          const size = p.SS(mode);
          st.bundles.marker.set(idx, { type, size, mode, colour: p.CO() });
        } else if (id === 13) {
          // TEXT REPRESENTATION (第 1 部 7.4.13): 番号・書体・精度・字の間隔・横の拡大率・色
          const idx = p.IX();
          const font = p.IX();
          const precision = p.E();
          const spacing = p.R();
          const expansion = p.R();
          st.bundles.text.set(idx, { font, precision, spacing, expansion, colour: p.CO() });
        } else if (id === 14) {
          // FILL REPRESENTATION (第 1 部 7.4.14): 番号・内側の塗り方・色・模様の線の番号・模様の番号
          const idx = p.IX();
          const style = p.E();
          const colour = p.CO();
          const hatch = p.IX();
          st.bundles.fill.set(idx, { style, colour, hatch, pattern: p.IX() });
        } else if (id === 19) {
          // GEOMETRIC PATTERN DEFINITION (第 1 部 7.4.19)
          const idx = p.IX();
          const seg = p.N();
          st.geoPatterns.set(idx, { seg, ext: [p.P(), p.P()] });
        }
        return;
      case 3: // 制御
        // NEW REGION: 閉じた図形の中で、開いている領域を閉じる
        if (id === 10) {
          connectEdge(figStart);
          closeRegion();
          return;
        }
        if (id === 1) st.vdcIntPrec = prec(p.I(), [16, 24, 32], st.vdcIntPrec, 'VDC INTEGER PRECISION');
        else if (id === 2) {
          const f = p.E();
          const a = p.I();
          const b = p.I();
          st.vdcRealForm = realForm(f === 0, a, b, st.vdcRealForm, 'VDC REAL PRECISION');
        } else if (id === 5) {
          st.clip = [p.P(), p.P()];
          if (!inMdr) updateClip();
        } else if (id === 6) {
          st.clipOn = p.E() === 1;
          if (!inMdr) updateClip();
        } else if (id === 18) st.textPathMode = p.E();
        else if (id === 19) st.mitreLimit = p.R();
        else if (id === 20) {
          // TRANSPARENT CELL COLOUR (第 1 部 7.5.20): on ならこの色のセル (CELL ARRAY・タイル) は描かない
          const on = p.E() === 1;
          const c = p.CO();
          st.transparentCell = on ? c : undefined;
        }
        return;
      case 4: // 図形 (絵の本体でだけ描く。メタファイル記述子・絵の記述子のセグメントの中の図形は、覚えるだけ)
        if (inMdr || !inPicture || !inBody) return;
        if (tiles && id !== 28 && id !== 29) {
          // タイルの並びの中はタイルだけ
          return;
        }
        withBundles(() => drawPrimitive(id, p));
        return;
      case 5: // 属性
        attribute(id, p, st);
        return;
      case 6: {
        // ESCAPE (第 1 部 7.8.1): 機能の番号と、データの記録 (SDR の形を推奨。附属書 D.4.7)。中身は登録簿で決まる。
        // 登録簿の 22 (Transparent Cell Colour。第 1・2 版のメタファイルの TRANSPARENT CELL COLOUR) と 45 (Alpha Transparency) を読む
        if (id !== 1) return;
        const fid = p.I();
        const rec = sdrMembers(new Params(p.SDR(), st), st);
        const first = (types: number[]) => rec.find((m) => types.includes(m.type) && m.values.length);
        if (fid === 22) {
          // 表示の on・off (E・I・IX) と色 (CI か CD。CCO の並びなら直接色の成分)。on・off が無ければ on
          const flag = first([5, 6, 11]);
          const on = flag ? flag.values[0] !== 0 : true;
          const ci = first([2]);
          const cd = first([3]);
          const cco = rec.find((m) => m.type === 17 && m.values.length >= 3);
          const c: Colour | undefined = ci
            ? { index: ci.values[0] as number }
            : cd
              ? directColour(st, cd.values[0] as number[])
              : cco
                ? directColour(st, cco.values as number[])
                : undefined;
          if (!on) st.transparentCell = undefined;
          else if (c) st.transparentCell = c;
          else warn('ESCAPE 22 (Transparent Cell Colour) の色が読めません');
        } else if (fid === 45) {
          // 不透明度 (実数 0.0〜1.0)。後の図形の塗り・線・字・印・セルに掛ける
          const r = first([12]);
          if (r) st.alpha = Math.min(1, Math.max(0, r.values[0] as number));
          else warn('ESCAPE 45 (Alpha Transparency) の値が読めません');
        } else warn(`ESCAPE ${fid} は、登録簿に無いか Kumiori の知らない機能なので読み飛ばします`);
        return;
      }
      case 8: // セグメントの制御と属性 (第 3 部 表 11)
        if (id === 1) {
          // COPY SEGMENT: 写す行列 (と、yes なら先にセグメントの行列) を掛けて、セグメントを描く。切り抜きは写した時のもの (CLIP INHERITANCE の既定 'state list')
          if (inMdr || !inBody) return;
          const sid = p.N();
          const m = [p.R(), p.R(), p.R(), p.R(), p.VDC(), p.VDC()];
          const applySeg = p.left >= 16 && p.E() === 1;
          const frag = replaySegment(sid, st);
          if (frag === undefined) return;
          const segXf = segments.get(sid)?.xf;
          const f = applySeg && segXf ? (q: Pt) => xfOf(m)(xfOf(segXf)(q)) : xfOf(m);
          emit(`<g${clipAttr()}><g transform="matrix(${fmtM(svgMatrix(f))})">${frag}</g></g>`, frag.length);
        } else if (id === 2) {
          // INHERITANCE FILTER: 選び方の並びと、設定 (0 state list: 写す時の属性を使う・1 segment: 定義した時の属性のまま)
          const vals: number[] = [];
          while (p.left >= 16) vals.push(p.E());
          const setting = vals.pop();
          const keys = new Set(vals.flatMap((v) => INHERIT[v] ?? []));
          const rest = st.inherit.filter((k) => !keys.has(k));
          st.inherit = setting === 0 ? [...rest, ...keys] : rest;
        } else if (id === 4 && rec && !replayDepth) {
          // SEGMENT TRANSFORMATION
          p.N();
          rec.xf = [p.R(), p.R(), p.R(), p.R(), p.VDC(), p.VDC()];
        }
        return;
      default:
        return;
    }
  };

  const updateClip = () => {
    if (!s.clipOn) {
      clipId = undefined;
      return;
    }
    const r = s.clip ?? defaultExtent(defaults);
    const a = map(r[0]);
    const b = map(r[1]);
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    clipId = `cgmc${clipSeq++}`;
    addDef(`<clipPath id="${clipId}"><rect x="${num(x)}" y="${num(y)}" width="${num(Math.abs(b[0] - a[0]))}" height="${num(Math.abs(b[1] - a[1]))}"/></clipPath>`);
  };

  const attribute = (id: number, p: Params, st: State) => {
    switch (id) {
      case 2:
        st.lineType = p.IX();
        break;
      case 3:
        st.lineWidth[st.lineWidthMode] = p.SS(st.lineWidthMode);
        break;
      case 4:
        st.lineColour = p.CO();
        break;
      case 6:
        st.markerType = p.IX();
        break;
      case 7:
        st.markerSize[st.markerSizeMode] = p.SS(st.markerSizeMode);
        break;
      case 8:
        st.markerColour = p.CO();
        break;
      case 10:
        st.textFont = p.IX();
        break;
      case 12:
        st.charExpansion = p.R();
        break;
      case 13:
        st.charSpacing = p.R();
        break;
      case 14:
        st.textColour = p.CO();
        break;
      case 15:
        st.charHeight = p.VDC();
        break;
      case 16:
        st.charOrientation = [p.VDC(), p.VDC(), p.VDC(), p.VDC()];
        break;
      case 17:
        st.textPath = p.E();
        break;
      case 18:
        st.textAlign = [p.E(), p.E(), p.R(), p.R()];
        break;
      case 22:
        st.interiorStyle = p.E();
        break;
      case 31:
        st.fillRef = p.P();
        break;
      case 43: {
        // INTERPOLATED INTERIOR: 形・基準の形 (2n の SS)・段の数 m・段の区切り (m 個の実数)・色 (三角形は 3 個、ほかは m+1 個)
        const style = p.IX();
        const nGeo = style === 1 ? 2 : 4;
        const geo: number[] = [];
        for (let k = 0; k < nGeo; k++) geo.push(p.SS(st.interiorMode));
        const m = p.I();
        const stages: number[] = [];
        // 段の数は、残りの引数に入る数まで (引数の外は 0 と読めるので、数の欄だけを信じると、短い要素で数百万回まわる)
        for (let k = 0; k < m && p.left > 0; k++) stages.push(p.R());
        const nc = style === 3 ? 3 : m + 1;
        const colours: Colour[] = [];
        for (let k = 0; k < nc && p.left > 0; k++) colours.push(p.CO());
        st.interp = { style, geo, stages, colours };
        break;
      }
      case 23:
        st.fillColour = p.CO();
        break;
      case 25:
        st.patternIndex = p.IX();
        break;
      case 32: {
        // PATTERN TABLE (第 1 部 7.7.32): 番号・nx・ny・局所の色の精度・色の並び (行の境目に埋めは無い)
        const idx = p.IX();
        const nx = p.I();
        const ny = p.I();
        const prec = p.I();
        if (!(nx > 0 && ny > 0) || nx * ny > MAX_PIXELS || ![0, 1, 2, 4, 8, 16, 24, 32].includes(prec)) break;
        // セルの数は、データに入る数まで (色の足りないセルは 1 番の色で埋めるが、それは 65,536 個の表まで)。大きさだけを書いた表
        // (10000 × 10000 で色が無い) は、塗るたびに 1 億個のセルの色を調べさせる
        const indexed = st.colourSelection === 0;
        const cellBits = indexed ? prec || st.colourIndexPrec : (prec || st.colourPrec) * compsOf(st.colourModel);
        if (nx * ny > 65536 && !(cellBits > 0 && nx * ny <= Math.floor(Math.max(0, p.left) / cellBits))) {
          warn('PATTERN TABLE の色の数が、セルの数に足りないので読みません');
          break;
        }
        // 同じ色のセルは、1 つの色を指す (palette の番号)。鍵は、色番号か、直接色の成分の並び
        const palette: Colour[] = [];
        const seen = new Map<number | string, number>();
        const cells = new Uint32Array(nx * ny);
        const slot = (key: number | string, make: () => Colour): number => {
          let n = seen.get(key);
          if (n === undefined) {
            n = palette.length;
            seen.set(key, n);
            palette.push(make());
          }
          return n;
        };
        let k = 0;
        for (; k < nx * ny && p.left > 0; k++) {
          if (indexed) {
            const ci = p.CI(prec || st.colourIndexPrec);
            cells[k] = slot(ci, () => ({ index: ci }));
          } else {
            const cd = p.CD(prec || st.colourPrec);
            cells[k] = slot(cd.join(','), () => directColour(st, cd));
          }
        }
        if (k < nx * ny) cells.fill(slot(-1, () => ({ index: 1 })), k);
        st.patternTable.set(idx, { nx, ny, uid: ++patternTableSeq, palette, cells });
        break;
      }
      case 33:
        // PATTERN SIZE (第 1 部 7.7.33): 高さの向き (x, y)・幅の向き (x, y)。単位は INTERIOR STYLE SPECIFICATION MODE
        st.patternSize = [0, 1, 2, 3].map(() => p.SS(st.interiorMode));
        break;
      case 24:
        st.hatchIndex = p.IX();
        break;
      case 27:
        st.edgeType = p.IX();
        break;
      case 28:
        st.edgeWidth[st.edgeWidthMode] = p.SS(st.edgeWidthMode);
        break;
      case 29:
        st.edgeColour = p.CO();
        break;
      case 30:
        st.edgeVisible = p.E() === 1;
        break;
      case 34: {
        // COLOUR TABLE: 開始番号と直接色の並び
        let i = p.CI();
        const n = compsOf(st.colourModel);
        while (p.left >= n * st.colourPrec) {
          const v = p.CD();
          const c = toRgb(st, v);
          // 絵の記述子・METAFILE DEFAULTS REPLACEMENT で色番号 0 を決めると、背景色も決まる (第 1 部 7.7.34)
          if (i === 0 && !inBody) st.background = c;
          // 色の型 6・8 (RGB-alpha・sRGB-alpha) の不透明度も覚える
          const a = toAlpha(st, v);
          if (a < 1) st.colourTableAlpha.set(i, a);
          else st.colourTableAlpha.delete(i);
          st.colourTable.set(i++, c);
        }
        break;
      }
      case 37:
        st.lineCap = p.IX();
        p.IX();
        break;
      case 38:
        st.lineJoin = p.IX();
        break;
      case 42:
        st.restrictedType = p.IX();
        break;
      case 1:
        st.lineBundle = p.IX();
        break;
      case 5:
        st.markerBundle = p.IX();
        break;
      case 9:
        st.textBundle = p.IX();
        break;
      case 11:
        st.textPrecision = p.E();
        break;
      case 19:
        st.charSetIndex = p.IX();
        break;
      case 20:
        st.altCharSetIndex = p.IX();
        break;
      case 21:
        st.fillBundle = p.IX();
        break;
      case 26:
        st.edgeBundle = p.IX();
        break;
      case 35:
        // ASPECT SOURCE FLAGS: (種類 0〜17, 0 個別・1 束ね表) の並び
        while (p.left >= 32) {
          const t = p.E();
          const v = p.E();
          if (t >= 0 && t < 18) st.asf[t] = v === 1;
        }
        break;
      case 39:
        st.lineCont = p.IX();
        break;
      case 40:
        st.lineOffset = Math.min(1, Math.max(0, p.R()));
        break;
      case 41:
        // TEXT SCORE TYPE: (種類, off・on) の並び。並びが属性の値になる (並びに無い種類は off)
        st.scores = [];
        while (p.left >= st.indexPrec + 16) {
          const t = p.IX();
          if (p.E() === 1 && !st.scores.includes(t)) st.scores.push(t);
        }
        break;
      case 46:
        st.edgeCont = p.IX();
        break;
      case 47:
        st.edgeOffset = Math.min(1, Math.max(0, p.R()));
        break;
      case 44:
        st.edgeCap = p.IX();
        p.IX();
        break;
      case 45:
        st.edgeJoin = p.IX();
        break;
      default:
        // 36 PICK IDENTIFIER と、記号の属性 (48 SYMBOL LIBRARY INDEX・49 SYMBOL COLOUR・50 SYMBOL SIZE・51 SYMBOL ORIENTATION。
        // POLYSYMBOL は描かないので、読むだけ) は警告しない
        if (id !== 36 && !(id >= 48 && id <= 51)) warn(`属性 ${elementName(5, id)} は読み飛ばします`);
    }
  };

  const drawPrimitive = (id: number, p: Params) => {
    const pts = () => {
      const out: Pt[] = [];
      const per = 2 * (s.vdcType === 0 ? s.vdcIntPrec : s.vdcRealForm.a + s.vdcRealForm.b);
      while (p.left >= per) out.push(p.P());
      return out;
    };
    switch (id) {
      case 1: {
        // POLYLINE
        const v = pts();
        if (v.length >= 2) line(pathOf(v, false));
        break;
      }
      case 2: {
        // DISJOINT POLYLINE: 2 点ずつの線分
        const v = pts();
        let d = '';
        for (let k = 0; k + 1 < v.length; k += 2) d += pathOf([v[k], v[k + 1]], false);
        if (d) line(d);
        break;
      }
      case 3: {
        // POLYMARKER: 印 (1 点・2 十字・3 星・4 丸・5 ばつ)
        const v = pts();
        const size = sizePx(s.markerSizeMode, s.markerSize[s.markerSizeMode], NOMINAL_MARKER_SIZE, 0.01);
        const r = size / 2;
        const c = hex(colourOf(s.markerColour));
        const ma = alphaOf(s.markerColour);
        const fo = ma < 1 ? ` fill-opacity="${num(ma)}"` : '';
        const so = ma < 1 ? ` stroke-opacity="${num(ma)}"` : '';
        // scaled・mm の大きさは表示装置の上の大きさ: 絵を拡大縮小しても、印の大きさと線の太さは変えない (位置は絵に従う)
        const fixed = fixedMode(s.markerSizeMode);
        const ve = fixed ? ' vector-effect="non-scaling-size non-scaling-stroke"' : '';
        // 印の線の太さ: 大きさの 7.5% (0.5pt まで) とする (大きさ 1 の印は細く、5 以上の印は約 0.5pt)
        const sw = fixed ? Math.min(size * 0.075, 0.5 / 0.75) : 1;
        for (const q of v) {
          const [px, py] = map(q);
          // 印の形は、原点 (0, 0) の周りに描いて、印の位置へ移す
          const [x, y] = [0, 0];
          const tr = ` transform="translate(${num(px)} ${num(py)})"`;
          const t = s.markerType;
          // 切り抜きは外側の g に付ける (印の要素の transform で、切り抜きの矩形まで動かないように)
          const wrap = (el: string) => emit(clipId ? `<g${clipAttr()}>${el}</g>` : el);
          if (t === 1) wrap(`<circle cx="${num(x)}" cy="${num(y)}" r="${num(Math.max(r / 4, fixed ? 0.25 : 0.5))}" fill="${c}"${fo}${tr}${ve}/>`);
          else if (t === 4) wrap(`<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}" fill="none" stroke="${c}"${so} stroke-width="${num(sw)}"${tr}${ve}/>`);
          else {
            let d = '';
            if (t === 2 || t === 3) d += `M${num(x - r)} ${num(y)}H${num(x + r)}M${num(x)} ${num(y - r)}V${num(y + r)}`;
            if (t === 3 || t === 5) d += `M${num(x - r)} ${num(y - r)}L${num(x + r)} ${num(y + r)}M${num(x - r)} ${num(y + r)}L${num(x + r)} ${num(y - r)}`;
            if (d) wrap(`<path d="${d}" fill="none" stroke="${c}"${so} stroke-width="${num(sw)}"${tr}${ve}/>`);
          }
        }
        break;
      }
      case 4:
      case 5: {
        // TEXT / RESTRICTED TEXT
        const box: [number, number] | undefined = id === 5 ? [p.VDC(), p.VDC()] : undefined;
        const pos = p.P();
        const final = p.E() === 1;
        const str = p.S();
        pendingText = { pos, box, str };
        if (final) {
          drawText(pos, str, box);
          pendingText = undefined;
        }
        break;
      }
      case 6: {
        // APPEND TEXT: 書きかけの文字列に足し、final で描く (第 1 部 附属書 D.4.5.1 の推奨)
        const final = p.E() === 1;
        const str = p.S();
        if (pendingText) {
          pendingText.str += str;
          if (final) {
            drawText(pendingText.pos, pendingText.str, pendingText.box);
            pendingText = undefined;
          }
        }
        break;
      }
      case 7: {
        // POLYGON
        const v = pts();
        if (v.length >= 2) filled(pathOf(v, true));
        break;
      }
      case 8: {
        // POLYGON SET: 点と辺の印 (0 見えない・1 見える・2 閉じて見えない・3 閉じて見える)
        const per = 2 * (s.vdcType === 0 ? s.vdcIntPrec : s.vdcRealForm.a + s.vdcRealForm.b) + 16;
        const v: Array<{ p: Pt; f: number }> = [];
        while (p.left >= per) v.push({ p: p.P(), f: p.E() });
        let d = '';
        let edges = '';
        let start = 0;
        for (let k = 0; k < v.length; k++) {
          const last = k === v.length - 1;
          let f = v[k].f;
          if (last && f < 2) f += 2; // 最後の点は閉じる (第 1 部 7.6.8)
          const a = v[k].p;
          const close = f >= 2;
          const b = close ? v[start].p : v[k + 1]?.p;
          d += (k === start ? `M${num(X(a[0]))} ${num(Y(a[1]))}` : `L${num(X(a[0]))} ${num(Y(a[1]))}`) + (close ? 'Z' : '');
          if (b && (f === 1 || f === 3)) edges += pathOf([a, b], false);
          if (close) start = k + 1;
        }
        if (d) filled(d, edges);
        break;
      }
      case 11: {
        // RECTANGLE
        const [a, b] = [p.P(), p.P()];
        filled(pathOf([a, [b[0], a[1]], b, [a[0], b[1]]], true));
        break;
      }
      case 12: {
        // CIRCLE
        const c = p.P();
        const r = p.VDC();
        const v = arcPoints((t) => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)], 0, 2 * Math.PI);
        filled(pathOf(v, true), undefined, false);
        break;
      }
      case 13:
      case 14: {
        // CIRCULAR ARC 3 POINT (CLOSE): 3 点を通る円の、始めから中を通って終わりまで
        const [a, m, b] = [p.P(), p.P(), p.P()];
        const closure = id === 14 ? p.E() : -1;
        const v = arc3(a, m, b);
        if (id === 13) line(pathOf(v.pts, false), false);
        else filled(pathOf(closure === 0 && v.centre ? [v.centre, ...v.pts] : v.pts, true), undefined, false);
        break;
      }
      case 15:
      case 16:
      case 20: {
        // CIRCULAR ARC CENTRE (CLOSE / REVERSED): 中心・始めと終わりの向き・半径。正の向き (REVERSED は負の向き) に描く
        const c = p.P();
        const s0: Pt = [p.VDC(), p.VDC()];
        const s1: Pt = [p.VDC(), p.VDC()];
        const r = p.VDC();
        const closure = id === 16 ? p.E() : -1;
        let a0 = Math.atan2(s0[1], s0[0]);
        let a1 = Math.atan2(s1[1], s1[0]);
        if (id === 20) [a0, a1] = [-a0, -a1];
        const t1 = sweep(a0, a1);
        const f = (t: number): Pt => (id === 20 ? [c[0] + r * Math.cos(-t), c[1] + r * Math.sin(-t)] : [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
        const v = arcPoints(f, a0, t1);
        if (id !== 16) line(pathOf(v, false), false);
        else filled(pathOf(closure === 0 ? [c, ...v] : v, true), undefined, false);
        break;
      }
      case 17:
      case 18:
      case 19: {
        // ELLIPSE / ELLIPTICAL ARC (CLOSE): 中心と共役直径の端の 2 点。点 = 中心 + cos t・(P1−中心) + sin t・(P2−中心) (第 1 部 6.6.7.2)
        const c = p.P();
        const p1 = p.P();
        const p2 = p.P();
        const a: Pt = [p1[0] - c[0], p1[1] - c[1]];
        const b: Pt = [p2[0] - c[0], p2[1] - c[1]];
        const f = (t: number): Pt => [c[0] + a[0] * Math.cos(t) + b[0] * Math.sin(t), c[1] + a[1] * Math.cos(t) + b[1] * Math.sin(t)];
        if (id === 17) {
          filled(pathOf(arcPoints(f, 0, 2 * Math.PI), true), undefined, false);
          break;
        }
        const s0: Pt = [p.VDC(), p.VDC()];
        const s1: Pt = [p.VDC(), p.VDC()];
        const closure = id === 19 ? p.E() : -1;
        // 向きの線と楕円の交点の t: 行列 [a b] の逆で単位円へ写した向きの角度。向きは第 1 の共役半径から第 2 へ (t の増える向き)
        const det = a[0] * b[1] - a[1] * b[0];
        if (Math.abs(det) < 1e-12) break;
        const tOf = (v: Pt) => Math.atan2((-a[1] * v[0] + a[0] * v[1]) / det, (b[1] * v[0] - b[0] * v[1]) / det);
        const t0 = tOf(s0);
        const t1 = sweep(t0, tOf(s1));
        const v = arcPoints(f, t0, t1);
        if (id === 18) line(pathOf(v, false), false);
        else filled(pathOf(closure === 0 ? [c, ...v] : v, true), undefined, false);
        break;
      }
      case 26: {
        // POLYBEZIER: 1 は 4 点ずつ、2 は最初が 4 点で以後 3 点ずつ
        const ci = p.IX();
        const v = pts();
        let d = '';
        const P = (q: Pt) => `${num(X(q[0]))} ${num(Y(q[1]))}`;
        if (ci === 1) for (let k = 0; k + 3 < v.length; k += 4) d += `M${P(v[k])}C${P(v[k + 1])} ${P(v[k + 2])} ${P(v[k + 3])}`;
        else if (v.length >= 4) {
          d = `M${P(v[0])}`;
          for (let k = 1; k + 2 < v.length; k += 3) d += `C${P(v[k])} ${P(v[k + 1])} ${P(v[k + 2])}`;
        }
        if (d) line(d);
        break;
      }
      case 9:
        cellArray(p);
        break;
      case 10:
        // GENERALIZED DRAWING PRIMITIVE (第 1 部 7.6.10): 中身は登録簿で決まるが、登録された GDP は無い (負の番号は処理系ごとの私用)
        warn(`GENERALIZED DRAWING PRIMITIVE (GDP ${p.I()}) は描きません (登録された GDP がありません)`);
        break;
      case 21:
        // CONNECTING EDGE: 閉じた図形の中で、前の線の要素の終わりから、次の点への辺を足す
        if (fig) connectFrom = figLast;
        break;
      case 22: {
        // HYPERBOLIC ARC (第 1 部 7.6.22・6.6.8): 標準の双曲線 x² − y² = 1 を、中心 C・横の半径の端 P1・共役の半径の端 P2 の行列で写したもの。
        // 点 = C ± (P1 − C)·cosh s + (P2 − C)·sinh s。始めと終わりの向きの半直線と双曲線の交点の間を描く
        const c = p.P();
        const a = sub(p.P(), c);
        const b = sub(p.P(), c);
        const s0: Pt = [p.VDC(), p.VDC()];
        const s1: Pt = [p.VDC(), p.VDC()];
        const det = a[0] * b[1] - a[1] * b[0];
        if (Math.abs(det) < 1e-12) break;
        // 向き v を (P1 − C, P2 − C) の組で表す: v = α·a + β·b
        const coef = (v: Pt): Pt => [(v[0] * b[1] - v[1] * b[0]) / det, (a[0] * v[1] - a[1] * v[0]) / det];
        const [al0, be0] = coef(s0);
        const [al1, be1] = coef(s1);
        const branch = Math.sign(al0);
        if (!(Math.abs(al0) > Math.abs(be0)) || !(Math.abs(al1) > Math.abs(be1)) || Math.sign(al1) !== branch) {
          warn('HYPERBOLIC ARC の向きが双曲線と交わらない (または両方の枝にまたがる) ので描きません');
          break;
        }
        const t0 = Math.atanh(be0 / Math.abs(al0));
        const t1 = Math.atanh(be1 / Math.abs(al1));
        const n = 64;
        const v: Pt[] = [];
        for (let k = 0; k <= n; k++) {
          const t = t0 + ((t1 - t0) * k) / n;
          v.push([c[0] + branch * a[0] * Math.cosh(t) + b[0] * Math.sinh(t), c[1] + branch * a[1] * Math.cosh(t) + b[1] * Math.sinh(t)]);
        }
        line(pathOf(v, false), false);
        break;
      }
      case 23: {
        // PARABOLIC ARC (第 1 部 7.6.23・6.6.9): 始めと終わりの点と、そこでの接線の交点 (中心)。標準の放物線の弧を写したものは、
        // 中心を制御点とする 2 次のベジエ曲線と同じ
        const c = p.P();
        const a = p.P();
        const b = p.P();
        line(`M${num(X(a[0]))} ${num(Y(a[1]))}Q${num(X(c[0]))} ${num(Y(c[1]))} ${num(X(b[0]))} ${num(Y(b[1]))}`);
        break;
      }
      case 24:
      case 25: {
        // NON-UNIFORM (RATIONAL) B-SPLINE (第 1 部 7.6.24・7.6.25・6.6.10.1。正誤表 1 の終わりの値): 次数 k、制御点 n、節点 n + k、
        // 始めと終わりの値、(有理なら) 重み n。始めから終わりまでの曲線を、de Boor の算法で点に分けて描く
        const k = p.I();
        const n = p.I();
        // 次数は 64 まで (実用の次数は 10 未満。大きな次数は計算が次数の 2 乗で増えるので、細工したファイルで止まらないように)
        if (!(k >= 1 && k <= 64 && n >= k && n <= 100000)) {
          warn(`${id === 25 ? 'NON-UNIFORM RATIONAL B-SPLINE' : 'NON-UNIFORM B-SPLINE'} の次数か制御点の数が読めないので描きません`);
          break;
        }
        // 制御点・節点・重みは、残りの引数に入る数まで読む (引数の外は 0 と読めるので、数の欄だけを信じると、10 バイトの要素 1 つで
        // 30 万回あまり読む)。数の欄のとおりに揃わなければ描かない
        const ctrl: Pt[] = [];
        for (let i = 0; i < n && p.left > 0; i++) ctrl.push(p.P());
        const knots: number[] = [];
        for (let i = 0; i < n + k && p.left > 0; i++) knots.push(p.R());
        const tmin = p.R();
        const tmax = p.R();
        const wts: number[] = [];
        if (id === 25) for (let i = 0; i < n && p.left > 0; i++) wts.push(p.R());
        if (ctrl.length !== n || knots.length !== n + k || (id === 25 && wts.length !== n)) {
          warn(`${id === 25 ? 'NON-UNIFORM RATIONAL B-SPLINE' : 'NON-UNIFORM B-SPLINE'} の制御点・節点が足りないので描きません`);
          break;
        }
        const v = bspline(k, ctrl, knots, Math.max(tmin, knots[k - 1]), Math.min(tmax, knots[n]), id === 25 ? wts : undefined);
        if (v.length >= 2) line(pathOf(v, false), false);
        break;
      }
      case 27:
        // POLYSYMBOL: 記号の表 (SYMBOL LIBRARY LIST の名前) はメタファイルの外のもので、形は規格に無く、登録簿にも登録された表が無い (第 1 部 6.6.12・7.3.23)
        warn('POLYSYMBOL は描きません (記号の表はメタファイルの外のもので、登録された表もありません)');
        break;
      case 28:
      case 29:
        if (tiles) tile(id === 28, p);
        break;
      default:
        warn(`図形 ${elementName(4, id)} は描きません`);
    }
  };

  const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
  /** B スプラインの点列 (de Boor の算法。重みがあれば有理: 同次座標で計算する) */
  const bspline = (k: number, P: Pt[], T: number[], t0: number, t1: number, w?: number[]): Pt[] => {
    const n = P.length;
    if (!(t1 >= t0)) return [];
    const at = (t: number): Pt | undefined => {
      // t を含む区間 T[i] ≤ t < T[i+1] (k−1 ≤ i ≤ n−1。二分探索。終わりの値は最後の空でない区間に入れる)
      let lo = k - 1;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (T[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      let i = lo;
      while (i > k - 1 && T[i] === T[i + 1]) i--;
      const d: Array<[number, number, number]> = [];
      for (let j = 0; j < k; j++) {
        const q = P[i - k + 1 + j];
        const wt = w ? w[i - k + 1 + j] : 1;
        if (!q) return undefined;
        d.push([q[0] * wt, q[1] * wt, wt]);
      }
      for (let r = 1; r < k; r++)
        for (let j = k - 1; j >= r; j--) {
          const ii = i - k + 1 + j;
          const den = T[ii + k - r] - T[ii];
          const a = den ? (t - T[ii]) / den : 0;
          d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
        }
      const [x, y, h] = d[k - 1];
      return h ? [x / h, y / h] : undefined;
    };
    const spans = new Set(T.filter((v) => v >= t0 && v <= t1)).size + 1;
    const m = Math.min(4000, Math.max(16, spans * 16));
    const out: Pt[] = [];
    for (let j = 0; j <= m; j++) {
      const q = at(t0 + ((t1 - t0) * j) / m);
      if (q) out.push(q);
    }
    return out;
  };

  /** セルの色の並びを読む (CELL ARRAY・PATTERN TABLE): 精度 0 は COLOUR (INDEX) PRECISION (第 3 部 表 7 の 9 番) */
  const readCell = (p: Params, prec: number): Colour =>
    s.colourSelection === 0 ? { index: p.CI(prec || s.colourIndexPrec) } : directColour(s, p.CD(prec || s.colourPrec));
  const sameColour = (a: Colour, b: Colour | undefined) =>
    !!b && ('index' in a ? 'index' in b && a.index === b.index : 'rgb' in b && a.rgb.every((v, k) => Math.abs(v - b.rgb[k]) < 1e-6));
  /**
   * セルの色を、画素の 4 バイト (R・G・B・不透明度) を 1 つの数に詰めた値にする (前の putCell が書いた値と同じ)。透明のセルの色なら -1。
   * セルごとに色のオブジェクトを作らずに書くために使う (CELL ARRAY・タイルは、セルの数だけ色を読む)
   */
  const packCell = (c: Colour): number => {
    if (sameColour(c, s.transparentCell)) return -1;
    const v = colourOf(c);
    // 各バイトは、Uint8Array に書くときと同じに 256 で割った余り (範囲の外の成分も、前の putCell と同じ値になる)
    const b = (x: number) => Math.round(x * 255) & 255;
    return b(v[0]) + b(v[1]) * 0x100 + b(v[2]) * 0x10000 + b(alphaOf(c)) * 0x1000000;
  };
  const putPacked = (rgba: Uint8Array, k: number, v: number) => {
    if (v < 0) return; // 透明 (0 のまま)
    rgba[k * 4] = v & 255;
    rgba[k * 4 + 1] = (v >>> 8) & 255;
    rgba[k * 4 + 2] = (v >>> 16) & 255;
    rgba[k * 4 + 3] = Math.floor(v / 0x1000000);
  };
  /** 色番号 → 詰めた値 (1 つの要素を読む間は色の表が変わらないので、番号ごとに 1 度だけ色にする) を返す関数 */
  const indexPacker = () => {
    const memo = new Map<number, number>();
    return (index: number): number => {
      let v = memo.get(index);
      if (v === undefined) memo.set(index, (v = packCell({ index })));
      return v;
    };
  };

  /**
   * CELL ARRAY (第 1 部 7.6.9、第 3 部 表 7 の 9 番と表 1 の注 11): 角 P・Q・R、nx・ny、局所の色の精度、表し方 (0 連なり・1 詰めた並び)、色の並び。
   * 行は P から R へ、行の進む向きは R から Q へ。(1, 1) のセルが P の角。各行は語の境目から始まる。連なりは (数 I、色) の並び
   */
  const cellArray = (p: Params) => {
    const P0 = p.P();
    const Q0 = p.P();
    const R0 = p.P();
    const nx = p.I();
    const ny = p.I();
    const prec = p.I();
    const mode = p.E();
    if (!(nx > 0 && ny > 0) || nx * ny > MAX_PIXELS || ![0, 1, 2, 4, 8, 16, 24, 32].includes(prec)) {
      warn('CELL ARRAY の大きさか精度が読めないので描きません');
      return;
    }
    // データのある行だけを画素にする: 1 行は少なくとも、詰めた並びなら nx 個のセル、連なりなら 1 組 (数と色) のビットを使うので、
    // 残りの引数に入る行の数はそこまで (それより先の行は、下のループでも読まれず、透明のまま)。寸法だけを書いたデータの無い要素で、
    // 大きな透明の画像を作らない。画像の行を減らした分は、行の進む向き (R → Q) の長さを同じ割合で縮めるので、描かれる所は変わらない
    const cellBits = (prec || (s.colourSelection === 0 ? s.colourIndexPrec : s.colourPrec)) * (s.colourSelection === 0 ? 1 : compsOf(s.colourModel));
    const rowBits = mode === 1 ? nx * cellBits : s.intPrec + cellBits;
    const rows = rowBits > 0 ? Math.min(ny, Math.ceil(Math.max(0, p.left) / rowBits)) : ny;
    if (!rows || !takePixels(nx * rows, 'CELL ARRAY')) return;
    const rgba = new Uint8Array(nx * rows * 4);
    // セルの色は、オブジェクトにせず、画素の値にして書く (色番号は番号ごとに 1 度だけ色にする)
    const indexed = s.colourSelection === 0;
    const pack = indexPacker();
    const read = (): number => (indexed ? pack(p.CI(prec || s.colourIndexPrec)) : packCell(readCell(p, prec)));
    for (let j = 0; j < rows && p.left > 0; j++) {
      p.alignWord();
      if (mode === 1) for (let i = 0; i < nx && p.left > 0; i++) putPacked(rgba, j * nx + i, read());
      else {
        let i = 0;
        while (i < nx && p.left > 0) {
          const cnt = p.I();
          const c = read();
          for (let r = 0; r < cnt && i < nx; r++, i++) putPacked(rgba, j * nx + i, c);
          if (cnt <= 0) break;
        }
      }
    }
    // 単位の正方形 (u: P → R、t: R → Q) を写す
    const a = mapVec(sub(R0, P0));
    const c = mapVec(sub(Q0, R0)).map((v) => (v * rows) / ny);
    const o = map(P0);
    const img = imageEl(rgba, nx, rows, [a[0], a[1], c[0], c[1], o[0], o[1]]);
    emit(clipId && !replayDepth ? `<g${clipAttr()}>${img}</g>` : img, img.length);
  };

  /** BEGIN TILE ARRAY (第 3 部 表 3 の 19 番) */
  const beginTileArray = (p: Params) => {
    const pos = p.P();
    const pathDir = p.E();
    const lineDir = p.E();
    const [ntp, ntl, ctp, ctl] = [p.I(), p.I(), p.I(), p.I()];
    const [csp, csl] = [p.R(), p.R()];
    const [offp, offl, ncp, ncl] = [p.I(), p.I(), p.I(), p.I()];
    const w = ntp * ctp;
    const h = ntl * ctl;
    if (!(ntp > 0 && ntl > 0 && ctp > 0 && ctl > 0) || w * h > MAX_PIXELS || !(csp > 0 && csl > 0)) {
      warn('BEGIN TILE ARRAY の大きさが読めないので、タイルの並びを描きません');
      return;
    }
    if (!takePixels(w * h, 'タイルの並び')) return;
    tiles = { pos, pathDir, lineDir, ntp, ntl, ctp, ctl, csp, csl, offp, offl, ncp, ncl, rgba: new Uint8Array(w * h * 4), next: 0 };
  };

  /**
   * TILE・BITONAL TILE (第 1 部 7.6.28・7.6.29、第 3 部 表 7 の 28・29 番): 圧縮の形 (0 全部背景・1 全部前景・2 T6・3 T4 1 次元・4 T4 2 次元・
   * 5 圧縮なし・6 連なり。登録簿の 7 baseline JPEG・8 LZW・9 PNG の圧縮 (deflate))、行の埋め (n > 0 なら各行を n の倍数のセルに埋めてから圧縮)、色 (BITONAL は背景・前景の 2 色)、SDR、BS
   */
  const tile = (bitonal: boolean, p: Params) => {
    const t = tiles!;
    const kind = p.IX();
    const pad = p.I();
    let bg: Colour;
    let fg: Colour;
    let prec = 1;
    if (bitonal) {
      bg = p.CO();
      fg = p.CO();
    } else {
      prec = p.I();
      // 全部背景・全部前景の色: indexed は 0 番・1 番、direct は背景色と前景色 (第 1 部 7.6.29)
      bg = s.colourSelection === 0 ? { index: 0 } : { rgb: s.background ?? DEVICE_BACKGROUND };
      fg = s.colourSelection === 0 ? { index: 1 } : { rgb: DEVICE_FOREGROUND };
    }
    const sdr = new Params(p.SDR(), s);
    const bs = p.rest();
    const idx = t.next++;
    if (idx >= t.ntp * t.ntl) return;
    const rowLen = pad > 0 ? Math.ceil(t.ctp / pad) * pad : t.ctp;
    // 行の埋めで増えるセルも画素の合計に数える (埋めの数 pad が巨大だと、1 行の長さ rowLen が pad そのものになり、
    // 連なりのループや、LZW・deflate を展開する長さの上限 (rowLen から決める) が、タイルの大きさと関係なく膨らむ)
    if (!(rowLen * t.ctl <= MAX_PIXELS) || !takePixels((rowLen - t.ctp) * t.ctl, 'TILE (行の埋め)')) return;
    // セルは、色のオブジェクトの配列にためず、タイルの並びの画素 (t.rgba) へじかに書く (読まれなかったセル・透明のセルの色は、元のまま)。
    // 前は、タイルごとに「セルの数の配列」と、セルごとの色のオブジェクトを作っていたので、deflate で縮めた 8000 × 8000 のタイル (62KB) で
    // 52 秒・3GB を使い、ヒープを使い切った
    const effPrec = bitonal ? 1 : prec || (s.colourSelection === 0 ? s.colourIndexPrec : s.colourPrec);
    const comps = s.colourSelection === 0 ? 1 : compsOf(s.colourModel);
    const indexed = s.colourSelection === 0;
    const bgP = packCell(bg);
    const fgP = packCell(fg);
    const pack = indexPacker();
    /** r から色を 1 つ読み、詰めた値にする */
    const packedFromBits = (r: Params): number => {
      if (bitonal) return r.uint(1) ? fgP : bgP;
      return indexed ? pack(r.CI(effPrec)) : packCell(directColour(s, r.CD(effPrec)));
    };
    // 並びの中のタイルの位置: セルの進む向きに ntp 個、行の進む向きに折り返す
    const tx = (idx % t.ntp) * t.ctp;
    const ty = Math.floor(idx / t.ntp) * t.ctl;
    const W0 = t.ntp * t.ctp;
    /** タイルの中のセル (j 行・i 列) の、並びの画素の番号 */
    const at = (j: number, i: number) => (ty + j) * W0 + tx + i;
    if (kind === 0 || kind === 1) {
      const v = kind === 0 ? bgP : fgP;
      if (v >= 0) for (let j = 0; j < t.ctl; j++) for (let i = 0; i < t.ctp; i++) putPacked(t.rgba, at(j, i), v);
    } else if (kind === 5 || kind === 6) {
      const r = new Params(bs, s);
      if (kind === 5) {
        for (let j = 0; j < t.ctl; j++)
          for (let i = 0; i < rowLen; i++) {
            if (r.left < effPrec * comps) break;
            const c = packedFromBits(r);
            if (i < t.ctp) putPacked(t.rgba, at(j, i), c);
          }
      } else {
        // 連なり: 数 (SDR の精度 n ビット) と色の組。行の埋めを含めて、行ごとに続けて数える
        sdr.I();
        sdr.I();
        const n = sdr.left > 0 ? sdr.I() : 8;
        let k = 0;
        const total = rowLen * t.ctl;
        while (k < total && r.left >= n + effPrec * comps && n > 0 && n <= 32) {
          const cnt = r.uint(n);
          const c = packedFromBits(r);
          for (let q = 0; q < cnt && k < total; q++, k++) {
            const i = k % rowLen;
            if (i < t.ctp) putPacked(t.rgba, at(Math.floor(k / rowLen), i), c);
          }
          if (cnt <= 0) break;
        }
      }
    } else if (kind >= 2 && kind <= 4) {
      // T.6・T.4 (ファクシミリの符号)。黒 (1) が前景 (1 番)、白 (0) が背景 (0 番)。多い色の精度では役に立たない (第 1 部 7.6.29 の注 2)
      const bits = decodeModifiedHuffman(bs, { width: rowLen, rows: t.ctl, compression: kind === 2 ? 4 : 3, twoDimensional: kind === 4 });
      if (!bits) warn('TILE の T.4 / T.6 の符号が読めません');
      else
        for (let j = 0; j < t.ctl; j++)
          for (let i = 0; i < t.ctp; i++) putPacked(t.rgba, at(j, i), bits[j * rowLen + i] ? fgP : bgP);
    } else if (kind === 7 && !bitonal) {
      // 登録簿の 7: baseline JPEG。BS は JPEG のデータ。色は直接色の RGB として置く (SDR の JPEG の色の型は読まない)
      const px = decodeJpeg(bs);
      if (!px) {
        warn('TILE の JPEG が読めません');
        return;
      }
      // 直接色 { rgb: [v / 255, …] } として前の putCell で書いたのと同じ値: 色は元の 8 ビットの値、不透明度は ESCAPE 45 の値、透明のセルの色 (直接色) は書かない
      const alpha = Math.round(s.alpha * 255);
      const tc = s.transparentCell && 'rgb' in s.transparentCell ? s.transparentCell.rgb : undefined;
      const mono = px.components !== 3;
      for (let j = 0; j < Math.min(t.ctl, px.height); j++)
        for (let i = 0; i < Math.min(t.ctp, px.width); i++) {
          const o = (j * px.width + i) * px.components;
          const v0 = px.data[o];
          const v1 = mono ? v0 : px.data[o + 1];
          const v2 = mono ? v0 : px.data[o + 2];
          if (tc && Math.abs(v0 / 255 - tc[0]) < 1e-6 && Math.abs(v1 / 255 - tc[1]) < 1e-6 && Math.abs(v2 / 255 - tc[2]) < 1e-6) continue;
          const k = at(j, i) * 4;
          t.rgba[k] = v0;
          t.rgba[k + 1] = v1;
          t.rgba[k + 2] = v2;
          t.rgba[k + 3] = alpha;
        }
    } else if (kind === 8 || kind === 9) {
      // 登録簿の 8: LZW (TIFF・PDF の形)、9: PNG の圧縮の形 0 (zlib の deflate)。展開した後は圧縮なし (5) と同じセルの並び。
      // PNG の圧縮で、行ごとに PNG のフィルタの番号 (0〜4) が付いた長さなら、フィルタを戻す (行はバイトの境目から)
      const bitsPerCell = effPrec * comps;
      const rowBytes = Math.ceil((rowLen * bitsPerCell) / 8);
      const limit = (rowBytes + 1) * t.ctl + 16;
      let data = kind === 8 ? lzwBytes(bs, limit) : inflateBytes(bs, limit);
      if (!data.length) {
        warn(`TILE の ${kind === 8 ? 'LZW' : 'PNG (deflate)'} の圧縮が読めません`);
        return;
      }
      let filtered = kind === 9 && data.length >= (rowBytes + 1) * t.ctl;
      for (let j = 0; filtered && j < t.ctl; j++) if (data[j * (rowBytes + 1)] > 4) filtered = false;
      if (filtered) data = unfilterPng(data, rowBytes, Math.max(1, Math.ceil(bitsPerCell / 8)), t.ctl);
      const r = new Params(data, s);
      for (let j = 0; j < t.ctl; j++) {
        if (filtered) r.seekByte(j * rowBytes);
        for (let i = 0; i < rowLen; i++) {
          if (r.left < bitsPerCell) break;
          const c = packedFromBits(r);
          if (i < t.ctp) putPacked(t.rgba, at(j, i), c);
        }
      }
    } else {
      warn(`TILE の圧縮の形 ${kind} は、登録簿に無いか Kumiori の知らない形なので読みません`);
      return;
    }
  };

  /**
   * END TILE ARRAY: 中身のある範囲 (画像のずれ・画像のセルの数) を描く。位置は中身のある最初のセルの角。セルの進む向きは VDC の x 軸から
   * 0・90・180・270 度、行の進む向きはそこから 90・270 度。セルの大きさは「VDC の 1 単位あたりのセルの数」(第 1 部 7.2.16) なので、
   * 1 つのセルの長さは、その逆数 (VDC)
   */
  const endTileArray = () => {
    const t = tiles!;
    tiles = undefined;
    const W0 = t.ntp * t.ctp;
    const H0 = t.ntl * t.ctl;
    const iw = Math.max(0, Math.min(t.ncp, W0 - t.offp));
    const ih = Math.max(0, Math.min(t.ncl, H0 - t.offl));
    if (!iw || !ih || t.offp < 0 || t.offl < 0) return;
    const rgba = new Uint8Array(iw * ih * 4);
    for (let j = 0; j < ih; j++) rgba.set(t.rgba.subarray(((t.offl + j) * W0 + t.offp) * 4, ((t.offl + j) * W0 + t.offp + iw) * 4), j * iw * 4);
    const ang = ([0, 90, 180, 270][t.pathDir] ?? 0) * (Math.PI / 180);
    const lang = ang + ((t.lineDir === 1 ? 270 : 90) * Math.PI) / 180;
    const dp: Pt = [(Math.cos(ang) * iw) / t.csp, (Math.sin(ang) * iw) / t.csp];
    const dl: Pt = [(Math.cos(lang) * ih) / t.csl, (Math.sin(lang) * ih) / t.csl];
    const a = mapVec(dp);
    const c = mapVec(dl);
    const o = map(t.pos);
    const el = imageEl(rgba, iw, ih, [a[0], a[1], c[0], c[1], o[0], o[1]]);
    emit(clipId && !replayDepth ? `<g${clipAttr()}>${el}</g>` : el, el.length);
  };

  /** 3 点を通る円弧 (第 1 部 7.6.13)。3 点が一直線なら折れ線 (附属書 D.4.5.4) */
  const arc3 = (a: Pt, m: Pt, b: Pt): { pts: Pt[]; centre?: Pt } => {
    const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
    if (Math.abs(d) < 1e-12) return { pts: [a, b] };
    const sq = (q: Pt) => q[0] * q[0] + q[1] * q[1];
    const cx = (sq(a) * (m[1] - b[1]) + sq(m) * (b[1] - a[1]) + sq(b) * (a[1] - m[1])) / d;
    const cy = (sq(a) * (b[0] - m[0]) + sq(m) * (a[0] - b[0]) + sq(b) * (m[0] - a[0])) / d;
    const r = Math.hypot(a[0] - cx, a[1] - cy);
    const ang = (q: Pt) => Math.atan2(q[1] - cy, q[0] - cx);
    const a0 = ang(a);
    const am = ang(m);
    const a1 = ang(b);
    // 正の向きに回って中の点を通るなら正の向き、通らなければ負の向き
    const pos = sweep(a0, a1);
    const mid = sweep(a0, am);
    const t1 = mid <= pos ? pos : pos - 2 * Math.PI;
    return { pts: arcPoints((t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)], a0, t1), centre: [cx, cy] };
  };

  for (const el of elements(bytes)) {
    // セグメントの中の要素を覚える (BEGIN SEGMENT・END SEGMENT と、セグメントの属性 (類 8 の 4〜7) は除く)
    if (rec && !(el.cls === 0 && el.id === 7) && !(el.cls === 8 && el.id >= 4)) rec.els.push(el);
    if (process(el, inPicture ? s : defaults, false) === 'stop') break;
    if (!inPicture && el.cls === 1) s = cloneState(defaults);
  }
  if (!count && !body.length) return undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}" height="${num(H)}" viewBox="0 0 ${num(W)} ${num(H)}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}</svg>`;
  return { svg, width: W, height: H, count, warnings: [...warnings] };
}
