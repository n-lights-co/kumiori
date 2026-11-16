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

/**
 * base64 → バイト列 (data: の URI の中身)。atob と同じ字を受け付け、同じものを誤りにする (HTML の「forgiving-base64 decode」:
 * ASCII の空白は除く、詰め物の = は無くてもよい、ほかの字があるか、長さを 4 で割って 1 余るなら誤り。誤りは atob と同じく投げる)。
 * 使える実行環境では、組み込みの変換 (Uint8Array.fromBase64・Node の Buffer) を使う
 * (atob の文字列から 1 字ずつ写す形は、画素の上限いっぱいの画像 (CGM のタイルの 256MB の PNG) で数秒かかっていた)
 */
export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const t = /[\t\n\f\r ]/.test(s) ? s.replace(/[\t\n\f\r ]+/g, '') : s;
  const body = t.length % 4 === 0 && t.endsWith('=') ? t.replace(/==?$/, '') : t;
  if (body.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(body)) {
    // 誤り (atob が投げる誤りと同じにする)
    atob(t);
    throw new DOMException('The string to be decoded is not correctly encoded.', 'InvalidCharacterError');
  }
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array<ArrayBuffer> }).fromBase64;
  if (typeof native === 'function') return native(body + '='.repeat((4 - (body.length % 4)) % 4));
  const B = (globalThis as { Buffer?: { from(s: string, enc: 'base64'): Uint8Array } }).Buffer;
  if (B) {
    // 小さな Buffer は共用の領域の一部なので、その時は写す (呼ぶ側が .buffer を使っても、ほかのバイトが混じらない)
    const b = B.from(body, 'base64');
    return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength && b.buffer instanceof ArrayBuffer ? new Uint8Array(b.buffer) : new Uint8Array(b);
  }
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
