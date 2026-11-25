/**
 * imageEmbed — ラスター画像 (PNG・JPEG) を、PDF の画像の XObject (ISO 32000-2 §8.9.5) として埋め込む。
 *
 * pdf-lib の画像の埋め込み (embedJpg・embedPng・PngEmbedder・JpegEmbedder・PDFImage) を使わずに、画像の辞書と流れを直に作り、
 * pdf-lib の文脈 (PDFContext) に入れる。辞書の鍵と並びは、pdf-lib の埋め込みの作るものと同じ (同じ画素なら、同じバイト列の PDF になる)。
 *  - JPEG: 頭 (SOF。ITU-T T.81 §B.2.2) から幅・高さ・成分の数・精度を読み、ファイルをそのまま DCTDecode の流れにする (ISO 32000-2 §7.4.8)
 *  - PNG: 展開せずに入れられる形 (灰・RGB・色の表で、飛び越しと tRNS の無いもの) は、IDAT をそのまま FlateDecode (Predictor 15) の流れにする。
 *    ほかの形 (α・tRNS・飛び越し・16 ビットなど) は、展開して (pixels.ts の decodePngForPdf) 8 ビットの RGB と α (SMask) にし、
 *    imageDeflate.ts の関数で圧縮して入れる
 *  - 入稿用 (PDF/X) の CMYK・灰の画像 (embedCmykImage)
 * 番号の取り方も pdf-lib の埋め込みと同じ: 画像の番号を先に取り、SMask はその後に足す。
 */
import { PDFHexString, type PDFContext, type PDFDocument, type PDFRawStream, type PDFRef } from 'pdf-lib';
import { decodeJpeg } from './jpeg';
import { decodePngForPdf, pngFilterBytesOk, pngWithinLimits, type PngPixelsForPdf } from './pixels';
import { imageDeflater, inflateZlib, type ImageDeflate } from './imageDeflate';
import { msg } from './messages';
import { rejoin, thisCall } from './callContext';

/** 埋め込んだ画像 (画像の XObject の番号と、画素の幅・高さ) */
export interface PdfImage {
  readonly ref: PDFRef;
  readonly width: number;
  readonly height: number;
}

/** 展開せずに入れる PNG の選び方と、展開して入れる画像の圧縮 (embedPngChecked・embedCmykImage) */
export interface PngEmbedOptions {
  /**
   * 16 ビットの PNG も、展開せずに BitsPerComponent 16 の画像として入れるか。16 は PDF 1.5 から (PDF Reference の PDF 1.5 版 §4.8.4)
   * なので、PDF 1.3・1.4 が元の PDF/X-1a・X-3 では false (展開して 8 ビットにする。上位の 8 ビット)。既定 false
   */
  bits16?: boolean;
  /** 展開した画素を圧縮する関数 (imageDeflate.ts の imageDeflater。既定は imageDeflater()) */
  deflate?: ImageDeflate;
}

/**
 * 画像の流れを make で作って、いま埋め込む。画像の番号を先に取り (make の中で足す SMask は、その後の番号になる)、流れを入れる
 * (pdf-lib の PDFImage.embed が、embedJpg・embedPng の取った番号に流れを入れるのと同じ順)
 */
function embedStream(context: PDFContext, width: number, height: number, make: (context: PDFContext) => PDFRawStream): PdfImage {
  const ref = context.nextRef();
  context.assign(ref, make(context));
  return { ref, width, height };
}

/** JPEG の頭 (SOF) から読んだもの */
interface JpegHeader {
  width: number;
  height: number;
  /** 標本の精度 (ビット。8 か 12) */
  precision: number;
  /** 成分の数 (1 灰・3 YCbCr か RGB・4 CMYK か YCCK) */
  components: number;
}

/**
 * JPEG の頭を読む: SOI の後の印 (ITU-T T.81 §B.1.1.2) を順にたどり、最初のフレームの頭 (SOF0〜SOF15 のうち、DHT (C4)・JPG (C8)・DAC (CC) を除くもの。
 * §B.1.1.3 の表 B.1) の、精度・高さ・幅・成分の数 (§B.2.2) を返す。印の前の詰め物の 0xFF (§B.1.1.2) は飛ばし、長さの無い印 (TEM・RST0〜7) は長さを読まない。
 * SOF より前に、走査の頭 (SOS)・画像の終わり (EOI)・データの終わりに来たら undefined
 */
function jpegHeader(b: Uint8Array): JpegHeader | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 2;
  while (at + 1 < b.length) {
    if (b[at] !== 0xff) return undefined;
    let m = b[at + 1];
    while (m === 0xff && at + 2 < b.length) m = b[++at + 1];
    at += 2;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
    if (m === 0xd9 || m === 0xda || at + 2 > b.length) return undefined;
    const len = dv.getUint16(at);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 8 || at + 8 > b.length) return undefined;
      return { precision: b[at + 2], height: dv.getUint16(at + 3), width: dv.getUint16(at + 5), components: b[at + 7] };
    }
    if (len < 2) return undefined;
    at += len;
  }
  return undefined;
}

/**
 * JPEG を埋め込む: ファイルをそのまま DCTDecode の画像の流れにする (ISO 32000-2 §7.4.8)。色空間は成分の数で、1 は DeviceGray、3 は DeviceRGB、
 * 4 は DeviceCMYK。CMYK の JPEG は、Decode [1 0 1 0 1 0 1 0] で値を反転させる (Photoshop などの書き出す CMYK の JPEG は、値を反転して持つ
 * (Adobe の APP14)。pdf-lib の埋め込みと同じ扱い)。辞書の鍵の並びも、pdf-lib の JpegEmbedder と同じ。
 * 頭の読めない JPEG・成分の数が 1・3・4 でない JPEG は投げる
 */
export function embedJpeg(pdf: PDFDocument, jpg: Uint8Array): PdfImage {
  const h = jpegHeader(jpg);
  if (!h) throw new Error(msg('JPEG: 画像の頭 (SOF) が読めません', 'JPEG: cannot read the frame header (SOF)'));
  const colorSpace = ({ 1: 'DeviceGray', 3: 'DeviceRGB', 4: 'DeviceCMYK' } as Record<number, string>)[h.components];
  if (!colorSpace) throw new Error(msg(`JPEG: 成分の数 ${h.components} の画像は入れられません`, `JPEG: images with ${h.components} components are not supported`));
  return embedStream(pdf.context, h.width, h.height, (context) =>
    context.stream(jpg, {
      Type: 'XObject',
      Subtype: 'Image',
      BitsPerComponent: h.precision,
      Width: h.width,
      Height: h.height,
      ColorSpace: colorSpace,
      Filter: 'DCTDecode',
      ...(colorSpace === 'DeviceCMYK' ? { Decode: [1, 0, 1, 0, 1, 0, 1, 0] } : {}),
    }),
  );
}

/** 展開せずに入れられる PNG の中身 (pngAsIs) */
interface PngAsIs {
  width: number;
  height: number;
  /** ビットの深さ (BitsPerComponent) */
  depth: number;
  /** 1 画素の成分の数 (DecodeParms の Colors) */
  colors: number;
  /** 色空間 (DeviceGray・DeviceRGB・色の表の Indexed) */
  colorSpace: unknown[] | string;
  /** IDAT をつないだもの (PNG の予測のフィルタ付きの zlib) */
  data: Uint8Array;
}

/**
 * IDAT をつないだ zlib の列 data が、走査線の大きさ need バイト (飛び越しでない並びの「(1 行のバイト数 + フィルタの 1 バイト) × 高さ」。
 * PNG の仕様 §7.2・§9.1) まで展開できるか。そのまま入れる PNG でも、切れた・壊れた画素のデータは、PDF を見る側で画像の流れの誤りになるので、
 * 入れる前に確かめる。展開は imageDeflate.ts の inflateZlib (Node は zlib、ブラウザ・Web Worker は DecompressionStream、断ったときは自前の展開)
 */
async function idatComplete(data: Uint8Array, width: number, height: number, bpp: number): Promise<boolean> {
  const need = (Math.ceil((width * bpp) / 8) + 1) * height;
  // 長さに加えて、各行の頭のフィルタの種類のバイトが 0〜4 かも見る (pixels.ts の pngFilterBytesOk。5 以上の行のある PNG を、
  // そのまま Predictor 15 の画像として入れない)
  const raw = rejoin(thisCall(), await inflateZlib(data, need));
  return raw.length >= need && pngFilterBytesOk(raw, width, height, bpp, false);
}

/**
 * 展開せずに FlateDecode (Predictor 15) の画像にできる PNG か。PNG の圧縮データ (IDAT をつないだもの) は、走査線ごとに PNG の予測の
 * フィルタの種類のバイトが付いた zlib (W3C の PNG の仕様 (Second Edition) §9・§10) なので、PDF の Flate の PNG の予測 (Predictor 15。
 * ISO 32000-2 §7.4.4.4 の表 10) の入力と同じ形になる。予測の 1 画素のバイト数は、どちらも成分の数 × ビットの深さを 8 で割って切り上げたもの。
 * 入れられるのは、飛び越しでなく、透明度 (tRNS) の無い、次の形 (§11.2.2 の表 11.1):
 *  - 灰 (色の型 0): 1・2・4・8 ビット (と、bits16 なら 16 ビット)。DeviceGray。PNG の灰の値 v / (2^深さ − 1) は、
 *    PDF の既定の Decode [0 1] の値と同じ (ISO 32000-2 §8.9.5.2)
 *  - RGB (色の型 2): 8 ビット (と、bits16 なら 16 ビット)。DeviceRGB
 *  - 色の表 (色の型 3): 1・2・4・8 ビット。Indexed (ISO 32000-2 §8.6.6.3)。表 (PLTE。§11.2.3) は 2^深さ の項に 0 (黒) で埋める
 *    (表に無い番号の画素は、展開して入れるときも黒にする。pixels.ts の decodePngForPdf)
 * 16 ビットの成分は、PNG も PDF も、上位のバイトが先 (PNG の §7.1・ISO 32000-2 §8.9.5.2)。
 * α・tRNS・飛び越しのあるもの、IHDR が最初のチャンクでない・長さが 13 でないもの (§5.6・§11.2.2)、色の表が IDAT の後・項の数が合わないものは undefined。
 * 形は合うが、画素のデータが終わりまで展開できない (切れた・壊れた) ものは 'broken' (checked のときは確かめない。呼ぶ側で確かめたもの)
 */
async function pngAsIs(png: Uint8Array, bits16: boolean, checked = false): Promise<PngAsIs | 'broken' | undefined> {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) return undefined;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (dv.getUint32(8) !== 13 || String.fromCharCode(png[12], png[13], png[14], png[15]) !== 'IHDR') return undefined;
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  const [depth, colorType, compression, filter, interlace] = png.subarray(24, 29);
  if (!width || !height || compression || filter || interlace) return undefined;
  const depths = colorType === 0 ? [1, 2, 4, 8, ...(bits16 ? [16] : [])] : colorType === 2 ? [8, ...(bits16 ? [16] : [])] : colorType === 3 ? [1, 2, 4, 8] : [];
  if (!depths.includes(depth)) return undefined;
  let plte: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  for (let at = 33; at + 8 <= png.length; ) {
    const len = dv.getUint32(at);
    const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    const body = png.subarray(at + 8, at + 8 + len);
    if (body.length < len) return undefined;
    if (type === 'tRNS' || type === 'IHDR') return undefined;
    if (type === 'PLTE') {
      // 色の表は IDAT の前に 1 つ (§5.6)。項の数は 1〜2^深さ (§11.2.3)
      if (plte || idat.length || len % 3 || !len || len / 3 > 2 ** Math.min(depth, 8)) return undefined;
      plte = body;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!idat.length || (colorType === 3 && !plte)) return undefined;
  const data = idat.length === 1 ? idat[0] : new Uint8Array(idat.reduce((a, b) => a + b.length, 0));
  if (idat.length > 1) idat.reduce((o, b) => (data.set(b, o), o + b.length), 0);
  const colors = colorType === 2 ? 3 : 1;
  if (!checked && !rejoin(thisCall(), await idatComplete(data, width, height, colors * depth))) return 'broken';
  let colorSpace: PngAsIs['colorSpace'] = colorType === 2 ? 'DeviceRGB' : 'DeviceGray';
  if (colorType === 3 && plte) {
    const table = new Uint8Array(3 << depth);
    table.set(plte);
    colorSpace = ['Indexed', 'DeviceRGB', (1 << depth) - 1, PDFHexString.of(Array.from(table, (b) => b.toString(16).padStart(2, '0')).join(''))];
  }
  return { width, height, depth, colors, colorSpace, data };
}

/**
 * 展開せずに埋め込める PNG (pngAsIs) は、IDAT をそのまま FlateDecode (Predictor 15) の画像にする。
 * 条件に合わなければ undefined (展開して埋め込む)。画素の数と展開の大きさの上限 (pixels.ts の pngWithinLimits) は、呼ぶ側で確かめる
 * (そのまま入れても、PDF を見る側が同じだけ展開する)。
 * 画素のデータが終わりまで展開できない PNG は、埋め込まずに投げる (展開して埋め込むときと同じ断り。
 * 確かめないと、切れた画素のデータが、知らせなしに壊れた画像の流れとして PDF に入る)。checked は、呼ぶ側で展開して確かめた PNG (確かめを省く)
 */
export async function embedPngAsIs(pdf: PDFDocument, png: Uint8Array, o: Pick<PngEmbedOptions, 'bits16'> = {}, checked = false): Promise<PdfImage | undefined> {
  const a = rejoin(thisCall(), await pngAsIs(png, o.bits16 ?? false, checked));
  if (a === 'broken') throw brokenPng();
  if (!a) return undefined;
  const { width, height, depth, colors, colorSpace, data } = a;
  return embedStream(pdf.context, width, height, (context) =>
    context.stream(data, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: width,
      Height: height,
      BitsPerComponent: depth,
      ColorSpace: colorSpace,
      Filter: 'FlateDecode',
      DecodeParms: { Predictor: 15, Colors: colors, BitsPerComponent: depth, Columns: width },
    } as never),
  );
}

/** 画素のデータが終わりまで展開できない PNG の誤り */
const brokenPng = () => new Error(msg('PNG: 画素のデータが壊れています', 'PNG: the pixel data is broken'));

/**
 * PNG を、8 ビットの RGB と α に展開する (pixels.ts の decodePngForPdf。どの形の PNG も)。
 * 画素のデータが終わりまで展開できない PNG・動く PNG (コマが 2 つ以上)・読めない形の PNG は投げる。pngWithinLimits を通った PNG に使う
 */
async function decodePngPixels(png: Uint8Array): Promise<PngPixelsForPdf> {
  const px = rejoin(thisCall(), await decodePngForPdf(png));
  if (px === 'broken') throw brokenPng();
  if (px === 'animated') throw new Error(msg('PNG: 動く PNG (APNG。コマが 2 つ以上) は PDF に入れられません', 'PNG: animated PNGs (APNG with two or more frames) cannot be placed in a PDF'));
  if (!px) throw new Error(msg('PNG: 画像の形 (IHDR・色の表) が読めません', 'PNG: cannot read the image format (IHDR or palette)'));
  return px;
}

/**
 * 展開した RGB と α を、圧縮してから埋め込む。辞書は pdf-lib の PngEmbedder (embedIntoContext・embedAlphaChannel) の作るものと同じ
 * (α は DeviceGray・Decode [0 1] の SMask)。圧縮は deflate
 */
async function embedRgbAlpha(pdf: PDFDocument, px: PngPixelsForPdf, deflate: ImageDeflate): Promise<PdfImage> {
  const { width, height } = px;
  const rgb = rejoin(thisCall(), await deflate(px.rgb));
  const alpha = px.alpha ? rejoin(thisCall(), await deflate(px.alpha)) : undefined;
  return embedStream(pdf.context, width, height, (context) => {
    const smask = alpha
      ? context.register(context.stream(alpha, { Type: 'XObject', Subtype: 'Image', Height: height, Width: width, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Decode: [0, 1], Filter: 'FlateDecode' }))
      : undefined;
    return context.stream(rgb, { Type: 'XObject', Subtype: 'Image', BitsPerComponent: 8, Width: width, Height: height, ColorSpace: 'DeviceRGB', ...(smask ? { SMask: smask } : {}), Filter: 'FlateDecode' });
  });
}

/**
 * PNG を埋め込む: 展開せずに入れられるもの (pngAsIs) は embedPngAsIs、ほかは展開して (decodePngForPdf)、RGB と α を o.deflate で圧縮して入れる。
 * どちらも、画素の数と展開の大きさの上限 (pixels.ts の pngWithinLimits) を超える PNG は埋め込まずに投げる
 * (展開せずに入れても、PDF を見る側が同じだけ展開する)
 */
export async function embedPngChecked(pdf: PDFDocument, png: Uint8Array, o: PngEmbedOptions = {}): Promise<PdfImage> {
  if (!pngWithinLimits(png)) throw new Error(msg('PNG: 画素の数か展開の大きさが上限を超えます', 'PNG: the number of pixels or the decompressed size exceeds the limit'));
  const asIs = rejoin(thisCall(), await embedPngAsIs(pdf, png, o));
  if (asIs) return asIs;
  const px = rejoin(thisCall(), await decodePngPixels(png));
  return embedRgbAlpha(pdf, px, o.deflate ?? imageDeflater());
}

/**
 * 入稿用 (PDF/X) の出力: RGB の画像 (PNG・JPEG) を画素に戻し、CMYK (DeviceCMYK・8 ビット・FlateDecode) の画像として埋め込む。
 * 色の変換は toCmyk (ICC の変換はしない)。透明度は SMask (DeviceGray) として残し、hasAlpha で知らせる。
 * 灰色だけの画像 (画素がすべて R = G = B。RGB・RGBA の PNG、16 ビット・1 ビットの灰色の PNG、灰色 + α の PNG も、展開すると RGB の
 * 3 つの成分になる) は、DeviceGray (8 ビット・FlateDecode) の画像にする (pdfStandard.ts の PdfStandard.cmyk: 灰色の画像は DeviceGray。
 * 値は R の成分そのものなので、濃さは変わらない。ISO 32000-2 §8.6.4.2・§10.4.2.2: DeviceRGB の r = g = b と、DeviceGray の同じ値は同じ灰色)。
 * 呼ぶ側のふつうの埋め込みは、灰色 (色の型 0) の PNG のほかを DeviceRGB で書くので、PDF/X-1a・X-3 の検査で止まっていた。
 * 展開せずにそのまま DeviceGray で入れられる PNG (灰色・インターレース無し・tRNS 無し。16 ビットは o.bits16 のときだけ) は、そのまま入れる (embedPngAsIs)。
 * 展開した画素は o.deflate で圧縮する。CMYK・灰色の JPEG (成分が 3 でないもの)・読めない画像は undefined (呼ぶ側で、ふつうに埋め込む)
 */
export async function embedCmykImage(
  pdf: PDFDocument,
  bytes: Uint8Array,
  kind: 'png' | 'jpg',
  toCmyk: (r: number, g: number, b: number) => number[],
  /**
   * 透明度のある画像の扱い: 'smask' はソフトマスク (SMask) を付けて埋め込む。'skip' は埋め込まずに、透明度があることと大きさだけを返す
   * (透明を平らにする出力。画像は、下の物と合わせて画素にする)
   */
  alphaMode: 'smask' | 'skip' = 'smask',
  o: PngEmbedOptions = {},
): Promise<{ image: PdfImage; hasAlpha: boolean } | { image?: undefined; hasAlpha: true; width: number; height: number } | undefined> {
  let width = 0;
  let height = 0;
  let rgb: Uint8Array;
  let alpha: Uint8Array | undefined;
  if (kind === 'jpg') {
    const px = decodeJpeg(bytes);
    if (!px || px.components !== 3) return undefined;
    ({ width, height } = px);
    rgb = px.data;
  } else {
    // 上限を超える PNG は展開しない (呼ぶ側のふつうの埋め込み (embedPngChecked) も断る)
    if (!pngWithinLimits(bytes)) return undefined;
    let px: PngPixelsForPdf;
    try {
      px = rejoin(thisCall(), await decodePngPixels(bytes));
    } catch {
      return undefined;
    }
    ({ width, height, rgb } = px);
    alpha = px.alpha;
  }
  if (alpha && alphaMode === 'skip') return { hasAlpha: true, width, height };
  let colourful = false;
  for (let i = 0; i < rgb.length && !colourful; i += 3) colourful = rgb[i] !== rgb[i + 1] || rgb[i + 1] !== rgb[i + 2];
  const deflate = o.deflate ?? imageDeflater();
  if (!colourful) {
    // 灰色 (IHDR の色の型 0) の PNG は、展開せずにそのまま DeviceGray で入れる (透明度が無いとき。tRNS があれば embedPngAsIs が断る)
    if (kind === 'png' && !alpha && bytes[25] === 0) {
      // 画素のデータは、上の展開 (decodePngPixels) で確かめてある
      const asIs = rejoin(thisCall(), await embedPngAsIs(pdf, bytes, o, true));
      if (asIs) return { image: asIs, hasAlpha: false };
    }
    const gray = new Uint8Array(width * height);
    for (let i = 0, o = 0; o < gray.length; i += 3, o++) gray[o] = rgb[i];
    return { image: rejoin(thisCall(), await embedImageStream(pdf, gray, width, height, 'DeviceGray', alpha, deflate)), hasAlpha: !!alpha };
  }
  const cmyk = new Uint8Array(width * height * 4);
  const memo = new Map<number, number[]>();
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    const key = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    let c = memo.get(key);
    if (!c) {
      c = toCmyk(rgb[i] / 255, rgb[i + 1] / 255, rgb[i + 2] / 255).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
      if (memo.size < 1 << 16) memo.set(key, c);
    }
    cmyk.set(c, o);
  }
  return { image: rejoin(thisCall(), await embedImageStream(pdf, cmyk, width, height, 'DeviceCMYK', alpha, deflate)), hasAlpha: !!alpha };
}

/** 8 ビットの画素 data (色空間 colorSpace の成分の並び) を、deflate で圧縮して FlateDecode の画像として埋め込む。alpha があれば SMask (DeviceGray) にする */
async function embedImageStream(pdf: PDFDocument, data: Uint8Array, width: number, height: number, colorSpace: 'DeviceCMYK' | 'DeviceGray', alpha: Uint8Array | undefined, deflate: ImageDeflate): Promise<PdfImage> {
  const z = rejoin(thisCall(), await deflate(data));
  const za = alpha ? rejoin(thisCall(), await deflate(alpha)) : undefined;
  return embedStream(pdf.context, width, height, (context) => {
    const smask = za ? context.register(context.stream(za, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: 'FlateDecode' })) : undefined;
    return context.stream(z, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: colorSpace, ...(smask ? { SMask: smask } : {}), Filter: 'FlateDecode' });
  });
}
