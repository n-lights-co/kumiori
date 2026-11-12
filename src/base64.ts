/**
 * バイト列 → base64 (data: の URI に入れる)。
 * 使える実行環境では、組み込みの変換を使う (Uint8Array.prototype.toBase64 (ECMAScript の提案「Uint8Array to/from base64」。新しいブラウザ・Node)、
 * 無ければ Node の Buffer)。どちらも無い所では、32KB ずつ文字列にしてから btoa に渡す。
 * 文字列を経る形は、画素の合計の上限いっぱいの画像 (CGM のタイルなどで 256MB の PNG) で 13 秒あまり掛かっていた (組み込みの変換なら 1 秒未満)。
 * どの形でも、出てくる字の並びは同じ (RFC 4648 §4 の base64。詰め物の = あり)
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
