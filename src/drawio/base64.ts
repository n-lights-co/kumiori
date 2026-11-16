/**
 * バイト列 → base64 (RFC 4648 §4。data: の URI に入れる)。
 * 使える実行環境では組み込みの変換 (Uint8Array.prototype.toBase64、無ければ Node の Buffer) を使い、
 * どちらも無い所では 32KB ずつ文字列にしてから btoa に渡す (Kumiori の src/base64.ts と同じ)
 */
export function base64(b: Uint8Array): string {
  const native = (b as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return native.call(b);
  const B = (globalThis as { Buffer?: { from(a: ArrayBufferLike, off: number, len: number): { toString(enc: 'base64'): string } } }).Buffer;
  if (B) return B.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
