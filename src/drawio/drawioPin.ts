/**
 * drawioPin — 既定の取り先 (DRAWIO_STENCILS_URL: draw.io の公開のリポジトリの、版を決めたタグの URL) から取った配布物のファイルを、
 * 版の SHA-256 の一覧 (drawioHashes.ts。scripts/drawio-hashes.mjs で、タグの指すコミットの中身から作る) と照らす。
 * タグは付け替えられる (同じ URL で中身が変わりうる) ので、一覧を作ったときの中身と同じものだけを使う。
 * 取った中身は実行せず文字・画像として読むだけだが、図形・画像の差し替えを防ぐ。
 * 利用者が別の取り先 (fetchStencils の URL の文字列・stencilsUrl。コマンドは --drawio-stencils-url) を決めたときは照らさない
 * (その版の一覧を Kumiori は持たない)。
 */
import { sha256 } from '../sha256';
import { DRAWIO_HASHES, DRAWIO_HASH_TAG } from './drawioHashes';
import { DRAWIO_STENCILS_PATH, DRAWIO_STENCILS_URL, drawioImageUrl } from './drawioStencil';

export { DRAWIO_HASH_TAG };

/** 配布物の中の道 (js/stencils.min.js・img/lib/…) → SHA-256 (base64url)。初めて使うときに読む */
let table: Map<string, string> | undefined;
function hashes(): Map<string, string> {
  if (table) return table;
  table = new Map();
  let dir = '';
  for (const line of DRAWIO_HASHES.split('\n')) {
    if (line.endsWith('/')) dir = line;
    // 名前は空白を含みうるので、終わりの 43 字 (SHA-256 の base64url) と、その前の空白で分ける
    else if (line.length > 44) table.set(dir + line.slice(0, -44), line.slice(-43));
  }
  return table;
}

/** 16 進の SHA-256 を base64url (詰め物の = は無し。RFC 4648 §5) にする (試験のために外に出す) */
export function base64url(hex: string): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const b = hex.match(/../g)!.map((h) => parseInt(h, 16));
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : '') + (i + 2 < b.length ? A[n & 63] : '');
  }
  return s;
}

/**
 * 取った配布物のファイルを照らした結果。unpinned: 既定の取り先からでない (照らさない)。ok: 一覧と合う。
 * mismatch: 一覧と合わない。unlisted: 一覧に無いファイル (その版の配布物に無かったもの)
 */
export type PinCheck = 'unpinned' | 'ok' | 'mismatch' | 'unlisted';

/** 配布物の中の道 path のファイルを url から取った中身 bytes を、一覧と照らす */
export function checkPinned(path: string, url: string, bytes: Uint8Array): PinCheck {
  const pinnedUrl = path === DRAWIO_STENCILS_PATH ? DRAWIO_STENCILS_URL : drawioImageUrl(path);
  if (url !== pinnedUrl) return 'unpinned';
  const want = hashes().get(path);
  if (!want) return 'unlisted';
  return base64url(sha256(bytes)) === want ? 'ok' : 'mismatch';
}
