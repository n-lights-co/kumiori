/** バイト列 → base64 (data: の URI に入れる。長い列は 32KB ずつ文字列にしてから btoa に渡す) */
export function base64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
