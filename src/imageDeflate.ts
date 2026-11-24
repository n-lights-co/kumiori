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
 *  3. CompressionStream の 'deflate' (ブラウザ・Web Worker。Compression Streams の仕様の 'deflate' は zlib の形 (RFC 1950))
 *  4. pako (どれも無い環境)
 * どれも、同じ環境・同じ入力なら同じバイト列を返すので、PdfOptions.date を渡せば、同じ PDF になる。
 */
import { deflate as pakoDeflate } from 'pako';
import { rejoin, thisCall } from './callContext';

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
  if (typeof CompressionStream === 'function') {
    return async (d) => new Uint8Array(rejoin(thisCall(), await new Response(new Blob([d as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()));
  }
  return async (d) => pakoDeflate(d);
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
