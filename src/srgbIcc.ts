/**
 * srgbIcc — sRGB (IEC 61966-2-1) の ICC プロファイルを、その場で作る (PDF/A の出力意図 (OutputIntent) の DestOutputProfile に使う)。
 *
 * 他者の作ったプロファイルのファイルを同梱せずに済むよう、sRGB の定義の値から組み立てる。形は ICC.1:2001-04 (版 2.1) の
 * 表示機器 (mntr) の行列と階調曲線 (matrix/TRC) のプロファイル。PDF/A-1 は ICC の版 2 系 (4.0 より前) を、PDF/A-2・3 は版 4 系までを
 * 受け付けるので、版 2.1 にしておけばどちらにも使える (ISO 19005-1 §6.2.2・ISO 19005-2 §6.2.3)。
 *  - 頭 (128 バイト。ICC.1:2001-04 §6.1): 大きさ・版・機器の種類 mntr・色空間 RGB・PCS は XYZ・'acsp'・PCS の光源 (D50)
 *  - 項目の表 (§6.2) と、項目と型 (§6.4・§6.5): desc (説明)・cprt (著作権の文)・wtpt (白色点)・rXYZ・gXYZ・bXYZ (原色の XYZ。D50 に順応した値)・
 *    rTRC・gTRC・bTRC (階調曲線。3 つとも同じ表を指す)
 * 原色の値は、sRGB の原色と D65 の白 (IEC 61966-2-1 §5.1) を Bradford の式で D50 に順応させたもの (ICC の sRGB のプロファイルと同じ値)。
 * 階調曲線は、sRGB の符号化の逆 (IEC 61966-2-1 §5.2: v ≤ 0.04045 なら v / 12.92、ほかは ((v + 0.055) / 1.055)^2.4) を 1024 点の表にしたもの
 */

/** sRGB の原色の XYZ (D50 に順応した値。ICC.1 の PCS は D50) */
const SRGB_D50 = {
  r: [0.4360747, 0.2225045, 0.0139322],
  g: [0.3850649, 0.7168786, 0.0971045],
  b: [0.1430804, 0.0606169, 0.7141733],
} as const;
/** PCS の光源 D50 (ICC.1:2001-04 §6.1 の頭の項目) */
const D50 = [0.9642, 1.0, 0.8249] as const;

/** 説明 (desc) の文 */
export const SRGB_DESCRIPTION = 'sRGB IEC61966-2.1';

let cached: Uint8Array | undefined;

/** sRGB の ICC プロファイル (版 2.1・表示機器・RGB → XYZ)。作ったものを覚えて使い回す (呼ぶ側は書き換えない) */
export function srgbProfile(): Uint8Array {
  return (cached ??= buildSrgbProfile());
}

function buildSrgbProfile(): Uint8Array {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const u16 = (v: number) => [(v >>> 8) & 255, v & 255];
  /** s15Fixed16Number (符号付きの固定小数点。整数部 16 ビット・小数部 16 ビット) */
  const s15 = (v: number) => u32(Math.round(v * 65536) | 0);
  /** textDescriptionType: ASCII の文、Unicode と ScriptCode の文は空 */
  const desc = (s: string) => [...ascii('desc'), 0, 0, 0, 0, ...u32(s.length + 1), ...ascii(s), 0, ...u32(0), ...u32(0), ...u16(0), 0, ...new Array(67).fill(0)];
  /** textType */
  const text = (s: string) => [...ascii('text'), 0, 0, 0, 0, ...ascii(s), 0];
  /** XYZType */
  const xyz = (v: readonly number[]) => [...ascii('XYZ '), 0, 0, 0, 0, ...v.flatMap(s15)];
  /** curveType: sRGB の符号化の逆の表 */
  const N = 1024;
  const curve = [...ascii('curv'), 0, 0, 0, 0, ...u32(N)];
  for (let i = 0; i < N; i++) {
    const v = i / (N - 1);
    const y = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    curve.push(...u16(Math.round(y * 65535)));
  }
  const tags: Array<[string, number[]]> = [
    ['desc', desc(SRGB_DESCRIPTION)],
    ['cprt', text('No copyright, use freely')],
    ['wtpt', xyz(D50)],
    ['rXYZ', xyz(SRGB_D50.r)],
    ['gXYZ', xyz(SRGB_D50.g)],
    ['bXYZ', xyz(SRGB_D50.b)],
    ['rTRC', curve],
  ];
  // 項目の中身は 4 バイトの境に置く。gTRC・bTRC は rTRC と同じ中身を指す (項目の表 (§6.2) は、項目が同じ中身を共有することを許す)
  const tableSize = 4 + 12 * (tags.length + 2);
  let offset = 128 + tableSize;
  const table: number[] = [...u32(tags.length + 2)];
  const data: number[] = [];
  let trc: [number, number] = [0, 0];
  for (const [sig, body] of tags) {
    table.push(...ascii(sig), ...u32(offset), ...u32(body.length));
    if (sig === 'rTRC') trc = [offset, body.length];
    const padded = [...body, ...new Array((4 - (body.length % 4)) % 4).fill(0)];
    data.push(...padded);
    offset += padded.length;
  }
  for (const sig of ['gTRC', 'bTRC']) table.push(...ascii(sig), ...u32(trc[0]), ...u32(trc[1]));
  const size = 128 + table.length + data.length;
  const head = new Array(128).fill(0);
  const put = (o: number, b: number[]) => b.forEach((x, k) => (head[o + k] = x));
  put(0, u32(size));
  put(8, [0x02, 0x10, 0, 0]); // 版 2.1.0
  put(12, ascii('mntr'));
  put(16, ascii('RGB '));
  put(20, ascii('XYZ '));
  // 作った日時 (dateTimeNumber): 決まった値にする (同じ入力から同じプロファイルを作るため)
  put(24, [...u16(2026), ...u16(1), ...u16(1), ...u16(0), ...u16(0), ...u16(0)]);
  put(36, ascii('acsp'));
  // 描き方の意図 (64〜67 バイト目) は 0 = 知覚的 (perceptual)。68〜79 バイト目は PCS の光源
  put(68, D50.flatMap(s15));
  return Uint8Array.from([...head, ...table, ...data]);
}
