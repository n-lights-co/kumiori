/**
 * documentText — 文書のバイト列を文字列にする (文字の符号化の判定)。コマンド (cli.ts)・画面 (main.ts)・公開 API が共に使う
 */

/**
 * 文書のバイト列を文字列にする。文字の符号化は、BOM (UTF-8・UTF-16)、XML 宣言の encoding (Shift_JIS・EUC-JP など)、
 * HTML の <meta charset> (または content="…; charset=…") の順に見て決める。どれも無ければ UTF-8。
 * 知らない符号化の名前は UTF-8 として読む (TextDecoder が復号できる符号化が使える)
 */
export function decodeDocumentText(bytes: Uint8Array): string {
  const utf8 = () => new TextDecoder('utf-8').decode(bytes);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8();
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  // 先頭を ASCII として見て、宣言の符号化の名前を探す (名前は ASCII で書かれる)
  const head = String.fromCharCode(...bytes.subarray(0, 2048));
  const label =
    /^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1] ??
    /<meta[^>]*?\scharset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1] ??
    /<meta[^>]*?\scontent\s*=\s*["'][^"']*?charset=\s*([\w.:-]+)/i.exec(head)?.[1];
  if (!label || /^utf-?8$/i.test(label)) return utf8();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return utf8();
  }
}
