/**
 * imageDeflate — PDF に入れる画像の画素を、埋め込むときに圧縮する関数 (zlib の形。RFC 1950)。
 *
 * pdf-lib は、画像の流れを作るとき (PDFContext.flateStream) に、JavaScript の pako で圧縮する。
 * 画素の多い画像 (画面写真の PNG など) では、PDF を書く時間の大半がこの圧縮になり、PDF の圧縮の関数 (選択肢の deflate) は、
 * 書く前に差し替える (pdfLibPatches.ts の useDeflate) ので、作るときに圧縮の済む画像の流れには効かなかった。
 * そこで、画像の流れは、作る前に、ここで決めた関数で圧縮してから、圧縮したバイト列の流れ (FlateDecode) として入れる。
 *
 * 使う関数は、次の順に決める:
 *  1. 選択肢の deflate (渡されたとき。ページの中身などと同じ関数)
 *  2. Node の zlib (process.getBuiltinModule で取る。Node 20.16・22.3 から。import を書かないので、ブラウザ向けの束にも入らない)
 *  3. CompressionStream の 'deflate' (ブラウザ・Web Worker。Compression Streams の仕様の 'deflate' は zlib の形 (RFC 1950))。
 *     入力は 1 度に書き、出力は読み手 (getReader) で集める (Blob と Response を通すと、入力を小さな塊に分けて流し直すので、1.5 倍ほど遅い)
 *  4. pako (どれも無い環境)
 * どれも、同じ環境・同じ入力なら同じバイト列を返すので、PdfOptions.date を渡せば、同じ PDF になる。
 */
import { deflate as pakoDeflate } from 'pako';
import { rejoin, thisCall } from './callContext';
import { inflateFast } from './inflateFast';

/** 画像の画素を圧縮する関数 (zlib の形) */
export type ImageDeflate = (data: Uint8Array) => Promise<Uint8Array>;

type ZlibLike = { deflateSync(data: Uint8Array): Uint8Array; inflateSync(data: Uint8Array, o: { maxOutputLength: number }): Uint8Array };

/** Node の zlib (Node でなければ undefined) */
function nodeZlib(): ZlibLike | undefined {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    const z = proc?.getBuiltinModule?.('node:zlib') as ZlibLike | undefined;
    return typeof z?.deflateSync === 'function' && typeof z.inflateSync === 'function' ? z : undefined;
  } catch {
    return undefined;
  }
}

/** 画像の画素を圧縮する関数を決める (deflate は、選択肢の deflate) */
export function imageDeflater(deflate?: (data: Uint8Array) => Uint8Array): ImageDeflate {
  if (deflate) return async (d) => deflate(d);
  const z = nodeZlib();
  if (z) return async (d) => z.deflateSync(d);
  if (typeof CompressionStream === 'function') return (d) => throughStream(new CompressionStream('deflate'), d);
  return async (d) => pakoDeflate(d);
}

/**
 * 変換の流れ (CompressionStream・DecompressionStream) に data を 1 度に書き、出たバイト列をつないで返す。limit を渡すと、
 * 出たバイト数が limit に届いた所で読むのを止め (流れの残りは取り消す)、初めの limit バイトを返す。流れの誤り (壊れた圧縮など) は投げる
 */
async function throughStream(t: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> }, data: Uint8Array, limit = Infinity): Promise<Uint8Array> {
  const w = t.writable.getWriter();
  // 書く側の約束は、読む側が誤りで止まったときにも拒まれるので、ここでは受けるだけにする (誤りは読む側で受け取る)
  w.write(data as BufferSource).catch(() => {});
  w.close().catch(() => {});
  const r = t.readable.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  try {
    while (n < limit) {
      const { done, value } = rejoin(thisCall(), await r.read());
      if (done) break;
      parts.push(value);
      n += value.length;
    }
  } finally {
    if (n >= limit) r.cancel().catch(() => {});
    r.releaseLock();
  }
  if (parts.length === 1 && n <= limit) return parts[0];
  const out = new Uint8Array(Math.min(n, limit));
  let at = 0;
  for (const p of parts) {
    if (at >= out.length) break;
    const k = Math.min(p.length, out.length - at);
    out.set(k === p.length ? p : p.subarray(0, k), at);
    at += k;
  }
  return out;
}

/**
 * zlib の形の圧縮 (PNG の IDAT) を、limit バイトまで展開する (pixels.ts の decodePngForPdf・imageEmbed.ts の展開せずに入れる PNG の確かめ)。
 *  1. Node の zlib (inflateNode)
 *  2. Node でなく DecompressionStream があれば (ブラウザ・Web Worker)、DecompressionStream の 'deflate' (zlib の形。Compression Streams の仕様)。
 *     DecompressionStream には出力の上限が無いので、出たバイト数が limit に届いたら読むのを止める
 *  3. どちらも断ったとき (壊れた・途中で切れた・終わりの後に余りがあるなど) と、どちらも無い環境は、自前の展開 (inflateFast.ts の inflateFast)。
 *     壊れたデータは、壊れた所までを返す (呼ぶ側で、長さが足りなければ壊れた画像として断る)
 * どの道も、正しい圧縮なら、同じバイト列 (初めの limit バイト) を返す
 */
export async function inflateZlib(src: Uint8Array, limit: number): Promise<Uint8Array> {
  const z = nodeZlib();
  if (z) {
    const raw = inflateNode(src, limit);
    if (raw && raw.length >= limit) return raw;
  } else if (typeof DecompressionStream === 'function') {
    try {
      const raw = rejoin(thisCall(), await throughStream(new DecompressionStream('deflate'), src, limit));
      if (raw.length >= limit) return raw;
    } catch {
      // 壊れた圧縮は、自前の展開で、壊れた所まで読む
    }
  }
  return inflateFast(src, limit);
}

/**
 * Node の zlib で、zlib の形の圧縮を解く (PNG の IDAT。pixels.ts の decodePngForPdf)。出力は limit バイトまで (maxOutputLength)。
 * Node でない・誤りのある圧縮 (途中で切れた・limit を超える・Adler-32 が合わないなど) は undefined (呼ぶ側で、自前の展開 (inflateFast.ts) に任せる。
 * 自前の展開は、壊れた所までを返す)
 */
export function inflateNode(src: Uint8Array, limit: number): Uint8Array | undefined {
  const z = nodeZlib();
  if (!z) return undefined;
  try {
    return z.inflateSync(src, { maxOutputLength: Math.max(1, limit) });
  } catch {
    return undefined;
  }
}
