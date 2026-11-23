/**
 * inflate — deflate の圧縮を解く (draw.io の圧縮したページと、図形ライブラリの配布物 stencils.min.js の中のライブラリ)。
 * draw.io は raw deflate (RFC 1951。zlib の頭と尾の無い形) で書く (draw.io の Graph.compress・Graph.decompress)。
 * 頭の付いた zlib (RFC 1950) も読む。戻した大きさが limit を超えたら、そこでやめて undefined を返す (小さなファイルで大量のメモリを使わせない)
 */

// pako 2 以降は、名前付きの書き出しだけを持つ (既定の書き出しが無い)
import { Inflate } from 'pako';

/** 戻した大きさが上限を超えた (投げて、圧縮を解くのを止める) */
class TooLarge extends Error {}

function run(b: Uint8Array, limit: number, raw: boolean, stats?: { bytes: number }): Uint8Array | undefined {
  const inf = new Inflate({ raw, chunkSize: 1 << 16 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  inf.onData = (c: Uint8Array) => {
    total += c.length;
    if (stats) stats.bytes += c.length;
    if (total > limit) throw new TooLarge();
    chunks.push(c);
  };
  try {
    inf.push(b, true);
  } catch (e) {
    if (e instanceof TooLarge) return undefined;
    throw e;
  }
  if (inf.err) return undefined;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * raw deflate (か zlib) の圧縮を解いたバイト列。読めない・上限を超えたら undefined。
 * stats を渡せば、戻したバイトの数 (途中でやめたものも、そこまでの数) を足す (図ごとの戻す大きさの合計の勘定)
 */
export function inflateBytes(b: Uint8Array, limit: number, stats?: { bytes: number }): Uint8Array | undefined {
  // zlib の頭 (CMF・FLG: 方式 8、(CMF × 256 + FLG) が 31 で割り切れる。RFC 1950 §2.2) なら zlib として読む
  const zlib = b.length > 2 && (b[0] & 0x0f) === 8 && ((b[0] << 8) | b[1]) % 31 === 0;
  try {
    return run(b, limit, !zlib, stats);
  } catch {
    return undefined;
  }
}
