/**
 * pdfEncrypt — PDF の暗号化 (標準セキュリティハンドラー。AES-256、V 5・R 6)。
 *
 * 根拠は ISO 32000-2:2020 (PDF 2.0) の次の節:
 *  - §7.6.2 文字列とストリームの暗号化の一般の決まり (暗号化の辞書・相互参照のストリームは暗号化しない。オブジェクトストリームの中の文字列は個別に暗号化せず、
 *    オブジェクトストリームの全体を暗号化する (§7.5.7 も))
 *  - §7.6.3 一般の暗号化の辞書 (Table 20: Filter・V・Length・CF・StmF・StrF)、§7.6.4 標準セキュリティハンドラー (Table 21: R・O・U・OE・UE・P・Perms・EncryptMetadata)
 *  - §7.6.4.2 アクセス権限のフラグ (Table 22)
 *  - §7.6.4.3.2 パスワードの扱い (SASLprep の後の UTF-8 を、127 バイトまでで切る) と Algorithm 2.B (ハッシュ。SHA-256・384・512 と AES-128-CBC の繰り返し)
 *  - §7.6.4.4.7 Algorithm 8 (U・UE)、§7.6.4.4.8 Algorithm 9 (O・OE)、§7.6.4.4.9 Algorithm 10 (Perms)
 *  - §7.6.5 暗号化フィルター (Table 25 の CFM が AESV3: AES-256 の CBC。データの先頭に 16 バイトの乱数の初期ベクトルを置き、PKCS#5 の詰め物を付ける (§7.6.3.1 の AES の記述))
 * AES-256 (R 6) は PDF 2.0 の暗号化。PDF 1.7 の見出しで書くので、カタログに Adobe の拡張の印 (Extensions の ADBE。BaseVersion 1.7・ExtensionLevel 8。§7.12) を書く。
 *
 * 計算の道具:
 *  - Node: crypto (process.getBuiltinModule で取得する。ハッシュも AES も同期)
 *  - ブラウザー・Worker: WebCrypto (crypto.subtle) のハッシュ (非同期) と、自前の AES の暗号化 (同期。FIPS 197)。
 *    PDF の書き出し (pdfWriter.ts) は、書き終えたオブジェクトをその場で (同期で) 書き、PDF を流して書くときはそのまま書き出し先へ渡すので、
 *    オブジェクトごとの暗号化は同期で要る。WebCrypto の AES (subtle.encrypt) は非同期なので使わず、自前の AES にする
 *    (結果は同じ。test/pdfEncrypt.test.ts が Node の crypto と比べる)。鍵を作る計算 (Algorithm 2.B) は、書き出しの前に 1 度だけ (非同期で) する
 *  - 乱数 (ファイルの暗号鍵・ソルト・初期ベクトル・文書の ID): crypto.getRandomValues (Node 22 とブラウザーの両方にある)
 * 暗号化した PDF は、初期ベクトルなどが乱数なので、同じ入力からも毎回違うバイト列になる。
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString } from 'pdf-lib';
import type { PDFContext, PDFObject, PDFRef } from 'pdf-lib';
import { KumioriOptionError } from './errors';
import { msg } from './messages';
import { rejoin, thisCall } from './callContext';

/**
 * 暗号化した PDF で許すこと (ISO 32000-2 §7.6.4.2 の Table 22。どれも既定 true (許す))。false にしたものを、P のフラグで禁じる。
 * 権限は、所有者のパスワードで開いた人には効かない。従うかどうかは PDF を読むソフトによる (守らないソフトもある)
 */
export interface PdfPermissions {
  /** 印刷 (bit 3)。false なら印刷を許さない (printHighQuality も効かない) */
  print?: boolean;
  /** 中身の変更 (bit 4。注釈・フォームと組み立てを除く変更) */
  modify?: boolean;
  /** 文字と図のコピー・抜き出し (bit 5) */
  copy?: boolean;
  /** 注釈の追加・変更と、フォームの入力 (bit 6) */
  annotate?: boolean;
  /** フォームの入力 (bit 9。annotate が false でも、フォームの入力だけを許す) */
  fillForms?: boolean;
  /**
   * 支援技術 (スクリーンリーダーなど) のための文字と図の抜き出し (bit 10)。PDF/UA (pdfua) では外せない (外そうとしたら警告して残す)。
   * ISO 32000-2 はこのフラグを廃止の扱いとし、読むソフトは無視する (書く側は 1 にすることを求める) ので、false にしても効かないソフトがある
   */
  accessibility?: boolean;
  /** 文書の組み立て (bit 11。ページの挿入・回転・削除、しおり・サムネイルの作成) */
  assemble?: boolean;
  /** 高品質の印刷 (bit 12。false なら、印刷を許しても粗い印刷だけを許す) */
  printHighQuality?: boolean;
}

/** 権限の名前と、Table 22 のビットの位置 (1 から数える) */
const PERMISSION_BITS: Record<keyof PdfPermissions, number> = {
  print: 3,
  modify: 4,
  copy: 5,
  annotate: 6,
  fillForms: 9,
  accessibility: 10,
  assemble: 11,
  printHighQuality: 12,
};
/** 権限の名前 (Table 22 のビットの順) */
export const PDF_PERMISSION_NAMES = Object.keys(PERMISSION_BITS) as Array<keyof PdfPermissions>;

/**
 * PDF の暗号化の設定 (PdfOptions.encrypt)。AES-256 (ISO 32000-2 の標準セキュリティハンドラーの R 6) で、文字列とストリームを暗号化する。
 *  - userPassword: 開くときのパスワード (利用者のパスワード)。無ければ空 (パスワード無しで開けて、permissions の制限だけが付く)
 *  - ownerPassword: 権限を外して開くパスワード (所有者のパスワード)。無ければ乱数 (権限を外して開ける人はいない)。
 *    userPassword と同じにすると、開いた人は誰でも権限を外せる
 *  - permissions: 許すこと (既定はどれも許す)
 * パスワードは、SASLprep (RFC 4013) で正規化した UTF-8 の、初めの 127 バイトを使う (ISO 32000-2 §7.6.4.3.2)。
 * PDF/A・PDF/X とは一緒に使えない (どちらも暗号化を許さない。KumioriPdfError の pdf/encrypt-incompatible)
 */
export interface PdfEncryptOptions {
  userPassword?: string;
  ownerPassword?: string;
  permissions?: PdfPermissions;
}

/** 選択肢のエラー (KumioriOptionError) */
const bad = (ja: string, en: string, option: string) => new KumioriOptionError(msg(ja, en), option);

/** encrypt の設定の形を確認する (知らない権限の名前は、書き間違いで黙って許さないようにエラーにする) */
export function checkEncryptOptions(o: unknown, path = 'encrypt'): asserts o is PdfEncryptOptions {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw bad(`${path} はオブジェクト ({ userPassword?, ownerPassword?, permissions? }) にしてください`, `${path} must be an object ({ userPassword?, ownerPassword?, permissions? })`, path);
  const e = o as Record<string, unknown>;
  for (const k of Object.keys(e))
    if (!['userPassword', 'ownerPassword', 'permissions'].includes(k)) throw bad(`${path} に知らない項目 ${k} があります (userPassword・ownerPassword・permissions)`, `${path} has an unknown key ${k} (userPassword, ownerPassword, permissions)`, `${path}.${k}`);
  for (const k of ['userPassword', 'ownerPassword'] as const) {
    if (e[k] === undefined) continue;
    if (typeof e[k] !== 'string') throw bad(`${path}.${k} は文字列にしてください`, `${path}.${k} must be a string`, `${path}.${k}`);
    // 使えない文字 (制御文字など) は、ここでエラーにする (saslprep が投げる)
    saslprep(e[k], `${path}.${k}`);
  }
  if (e.permissions !== undefined) {
    const p = e.permissions;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) throw bad(`${path}.permissions はオブジェクトにしてください`, `${path}.permissions must be an object`, `${path}.permissions`);
    for (const [k, v] of Object.entries(p)) {
      if (!(PDF_PERMISSION_NAMES as string[]).includes(k)) throw bad(`${path}.permissions に知らない権限 ${k} があります (${PDF_PERMISSION_NAMES.join('・')})`, `${path}.permissions has an unknown permission ${k} (${PDF_PERMISSION_NAMES.join(', ')})`, `${path}.permissions.${k}`);
      if (v !== undefined && typeof v !== 'boolean') throw bad(`${path}.permissions.${k} は真偽値にしてください`, `${path}.permissions.${k} must be a boolean`, `${path}.permissions.${k}`);
    }
  }
}

/**
 * 権限の P の値 (ISO 32000-2 §7.6.4.2 の Table 22。32 ビットの符号付きの整数)。bit 1・2 は 0、bit 7・8 と 13〜32 は 1 (予約)、
 * 3〜6・9〜12 は permissions のとおり (既定 1)
 */
export function permissionBits(p: PdfPermissions = {}): number {
  let bits = 0xfffff0c0; // bit 7・8・13〜32
  for (const name of PDF_PERMISSION_NAMES) if (p[name] !== false) bits |= 1 << (PERMISSION_BITS[name] - 1);
  return bits | 0;
}

/**
 * SASLprep (RFC 4013) の写像と正規化: 空白に写す文字 (§2.1 の C.1.2) を空白に、何にも写さない文字 (RFC 3454 の B.1) を除き、NFKC で正規化する (§2.2)。
 * 禁じる文字 (§2.3 の C.2〜C.9 のうち、制御文字・私用の文字・非文字・サロゲート・表示を変える文字・タグの文字) があればエラー。
 * 割り当てのない符号位置の確認と、双方向の文字の確認 (§2.4) はしない
 */
/** SASLprep (RFC 4013 §2.3) で禁じる文字: C.2.1・C.2.2 (制御文字)・C.3 (私用)・C.4 (非文字。下の \p{Noncharacter_Code_Point} も)・C.5 (サロゲート)・C.8 (表示を変える文字)・C.9 (タグ) */
const PROHIBITED = /[\u0000-\u001f\u007f-\u009f\u06dd\u070f\u180e\u200e\u200f\u2028-\u202e\u206a-\u206f\ufff9-\ufffc\ue000-\uf8ff\ufdd0-\ufdef\ufffe\uffff\u{1d173}-\u{1d17a}\u{e0001}\u{e0020}-\u{e007f}\u{f0000}-\u{10ffff}]|[\ud800-\udfff]/u;

function saslprep(s: string, option: string): string {
  const mapped = s.replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ').replace(/[\u00ad\u034f\u1806\u180b-\u180d\u200b-\u200d\u2060\ufe00-\ufe0f\ufeff]/g, '');
  const out = mapped.normalize('NFKC');
  if (PROHIBITED.test(out) || /\p{Noncharacter_Code_Point}/u.test(out))
    throw bad(`${option} に、パスワードに使えない文字 (制御文字・私用の文字など。RFC 4013 §2.3) があります`, `${option} has a character that cannot be used in a password (a control or private-use character, etc.; RFC 4013 §2.3)`, option);
  return out;
}

/** パスワードのバイト列 (SASLprep の後の UTF-8 の、初めの 127 バイト。ISO 32000-2 §7.6.4.3.2) */
function passwordBytes(s: string, option: string): Uint8Array {
  return new TextEncoder().encode(saslprep(s, option)).slice(0, 127);
}

// ---- 計算の道具 ----

/** ハッシュの種類 (Algorithm 2.B) */
type HashName = 'SHA-256' | 'SHA-384' | 'SHA-512';

/** 暗号化の計算の道具。aesCbc は同期 (PDF の書き出しの中で使う)、digest は同期でも非同期でもよい */
export interface CryptoBackend {
  /** AES の CBC で暗号化する (鍵は 16・32 バイト、iv は 16 バイト)。pad なら PKCS#5 の詰め物を付け、無ければ data の長さは 16 の倍数 */
  aesCbc(key: Uint8Array, iv: Uint8Array, data: Uint8Array, pad: boolean): Uint8Array;
  digest(name: HashName, data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  random(n: number): Uint8Array;
}

type NodeCrypto = {
  createCipheriv(alg: string, key: Uint8Array, iv: Uint8Array): { setAutoPadding(on: boolean): unknown; update(d: Uint8Array): Uint8Array; final(): Uint8Array };
  createHash(alg: string): { update(d: Uint8Array): { digest(): Uint8Array } };
};

/** Node の crypto (Node でなければ undefined。process.getBuiltinModule で取得するので、ブラウザー向けのバンドルにも入らない) */
const nodeCrypto = (() => {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    const c = proc?.getBuiltinModule?.('node:crypto') as NodeCrypto | undefined;
    return typeof c?.createCipheriv === 'function' && typeof c.createHash === 'function' ? c : undefined;
  } catch {
    return undefined;
  }
})();

/** 乱数 (crypto.getRandomValues。65536 バイトずつ) */
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
  if (typeof c?.getRandomValues !== 'function') throw new Error('Kumiori: crypto.getRandomValues is not available (PDF encryption needs a secure random source)');
  for (let i = 0; i < n; i += 65536) c.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

/** Node の crypto の道具 */
function nodeBackend(c: NodeCrypto): CryptoBackend {
  const concat = (a: Uint8Array, b: Uint8Array) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  return {
    aesCbc(key, iv, data, pad) {
      const ci = c.createCipheriv(`aes-${key.length * 8}-cbc`, key, iv);
      ci.setAutoPadding(pad);
      return concat(new Uint8Array(ci.update(data)), new Uint8Array(ci.final()));
    },
    digest: (name, data) => new Uint8Array(c.createHash(name.toLowerCase().replace('-', '')).update(data).digest()),
    random: randomBytes,
  };
}

/** WebCrypto (ハッシュ) と自前の AES の道具 (ブラウザー・Worker) */
export function webBackend(): CryptoBackend {
  return {
    aesCbc: aesCbcJs,
    async digest(name, data) {
      const subtle = (globalThis as { crypto?: { subtle?: { digest(n: string, d: Uint8Array): Promise<ArrayBuffer> } } }).crypto?.subtle;
      if (!subtle) throw new Error('Kumiori: crypto.subtle is not available (PDF encryption needs WebCrypto; in a browser, use a secure context such as https)');
      return new Uint8Array(rejoin(thisCall(), await subtle.digest(name, data)));
    },
    random: randomBytes,
  };
}

/** 実行環境の道具 (Node なら crypto、ほかは WebCrypto と自前の AES) */
export function defaultBackend(): CryptoBackend {
  return nodeCrypto ? nodeBackend(nodeCrypto) : webBackend();
}

// ---- AES (FIPS 197。暗号化だけ) ----

/** S-box (FIPS 197 §5.1.1) と、MixColumns を表にした T 表 (FIPS 197 §5.1.3 を、ラウンドごとに 4 回の表引きにしたもの) */
const SBOX = new Uint8Array(256);
const T0 = new Uint32Array(256);
const T1 = new Uint32Array(256);
const T2 = new Uint32Array(256);
const T3 = new Uint32Array(256);
{
  // GF(2^8) の逆数と、アフィン変換 (§5.1.1) から S-box を作る
  const exp = new Uint8Array(256);
  const log = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0); // x * 3
    x &= 0xff;
  }
  for (let i = 0; i < 256; i++) {
    const inv = i === 0 ? 0 : exp[(255 - log[i]) % 255];
    let s = inv;
    for (let k = 1; k < 5; k++) s ^= ((inv << k) | (inv >> (8 - k))) & 0xff;
    SBOX[i] = s ^ 0x63;
  }
  const xt = (b: number) => ((b << 1) ^ (b & 0x80 ? 0x11b : 0)) & 0xff;
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i];
    const s2 = xt(s);
    const s3 = s2 ^ s;
    T0[i] = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    T1[i] = ((s3 << 24) | (s2 << 16) | (s << 8) | s) >>> 0;
    T2[i] = ((s << 24) | (s3 << 16) | (s2 << 8) | s) >>> 0;
    T3[i] = ((s << 24) | (s << 16) | (s3 << 8) | s2) >>> 0;
  }
}

/** 鍵の展開 (FIPS 197 §5.2)。16 バイトなら 10 ラウンド、32 バイトなら 14 ラウンド */
function expandKey(key: Uint8Array): Uint32Array {
  const nk = key.length / 4;
  if (nk !== 4 && nk !== 8) throw new Error(`Kumiori: bad AES key length ${key.length}`);
  const rounds = nk + 6;
  const w = new Uint32Array(4 * (rounds + 1));
  for (let i = 0; i < nk; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  let rcon = 1;
  for (let i = nk; i < w.length; i++) {
    let t = w[i - 1];
    if (i % nk === 0) {
      t = ((SBOX[(t >>> 16) & 0xff] << 24) | (SBOX[(t >>> 8) & 0xff] << 16) | (SBOX[t & 0xff] << 8) | SBOX[t >>> 24]) ^ (rcon << 24);
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 0xff;
    } else if (nk > 6 && i % nk === 4) t = (SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 0xff] << 16) | (SBOX[(t >>> 8) & 0xff] << 8) | SBOX[t & 0xff];
    w[i] = (w[i - nk] ^ t) >>> 0;
  }
  return w;
}

/** AES の CBC の暗号化 (自前。FIPS 197 と NIST SP 800-38A §6.2)。pad なら PKCS#5 (RFC 8018 §6.1.1) の詰め物を付ける */
export function aesCbcJs(key: Uint8Array, iv: Uint8Array, data: Uint8Array, pad: boolean): Uint8Array {
  const w = expandKey(key);
  const rounds = w.length / 4 - 1;
  const n = pad ? (Math.floor(data.length / 16) + 1) * 16 : data.length;
  if (n % 16) throw new Error('Kumiori: AES-CBC data without padding must be a multiple of 16 bytes');
  const out = new Uint8Array(n);
  out.set(data);
  if (pad) out.fill(n - data.length, data.length);
  const word = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  let c0 = word(iv, 0);
  let c1 = word(iv, 4);
  let c2 = word(iv, 8);
  let c3 = word(iv, 12);
  for (let off = 0; off < n; off += 16) {
    let s0 = (word(out, off) ^ c0 ^ w[0]) >>> 0;
    let s1 = (word(out, off + 4) ^ c1 ^ w[1]) >>> 0;
    let s2 = (word(out, off + 8) ^ c2 ^ w[2]) >>> 0;
    let s3 = (word(out, off + 12) ^ c3 ^ w[3]) >>> 0;
    for (let r = 1; r < rounds; r++) {
      const k = 4 * r;
      const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 0xff] ^ T2[(s2 >>> 8) & 0xff] ^ T3[s3 & 0xff] ^ w[k];
      const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 0xff] ^ T2[(s3 >>> 8) & 0xff] ^ T3[s0 & 0xff] ^ w[k + 1];
      const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 0xff] ^ T2[(s0 >>> 8) & 0xff] ^ T3[s1 & 0xff] ^ w[k + 2];
      const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 0xff] ^ T2[(s1 >>> 8) & 0xff] ^ T3[s2 & 0xff] ^ w[k + 3];
      s0 = t0 >>> 0;
      s1 = t1 >>> 0;
      s2 = t2 >>> 0;
      s3 = t3 >>> 0;
    }
    // 最後のラウンド (MixColumns なし)
    const k = 4 * rounds;
    const f = (a: number, b: number, c: number, d: number, kw: number) => (((SBOX[a >>> 24] << 24) | (SBOX[(b >>> 16) & 0xff] << 16) | (SBOX[(c >>> 8) & 0xff] << 8) | SBOX[d & 0xff]) ^ kw) >>> 0;
    c0 = f(s0, s1, s2, s3, w[k]);
    c1 = f(s1, s2, s3, s0, w[k + 1]);
    c2 = f(s2, s3, s0, s1, w[k + 2]);
    c3 = f(s3, s0, s1, s2, w[k + 3]);
    for (const [j, v] of [c0, c1, c2, c3].entries()) {
      out[off + 4 * j] = v >>> 24;
      out[off + 4 * j + 1] = (v >>> 16) & 0xff;
      out[off + 4 * j + 2] = (v >>> 8) & 0xff;
      out[off + 4 * j + 3] = v & 0xff;
    }
  }
  return out;
}

// ---- 鍵と暗号化の辞書 ----

const concatAll = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * Algorithm 2.B (ISO 32000-2 §7.6.4.3.4): パスワード・ソルト (8 バイト)・udata (所有者のときは U の 48 バイト、利用者のときは空) からハッシュ (32 バイト) を作る。
 * K を SHA-256 (パスワード ‖ ソルト ‖ udata) から始め、K1 = (パスワード ‖ K ‖ udata) を 64 回並べたものを、K の初めの 16 バイトを鍵・次の 16 バイトを
 * 初期ベクトルにした AES-128-CBC (詰め物なし) で E にし、E の初めの 16 バイトを 128 ビットの数と見た 3 の剰余 (各バイトの和の 3 の剰余と同じ) で
 * SHA-256・384・512 を選んで K = ハッシュ (E) とする。64 回以上繰り返し、E の最後のバイトが (回の数 − 32) 以下になったら止める
 */
async function hash2B(b: CryptoBackend, password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = rejoin(thisCall(), await b.digest('SHA-256', concatAll(password, salt, udata)));
  for (let round = 1; ; round++) {
    const one = concatAll(password, k, udata);
    const k1 = new Uint8Array(one.length * 64);
    for (let i = 0; i < 64; i++) k1.set(one, i * one.length);
    const e = b.aesCbc(k.subarray(0, 16), k.subarray(16, 32), k1, false);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    k = rejoin(thisCall(), await b.digest((['SHA-256', 'SHA-384', 'SHA-512'] as const)[sum % 3], e));
    if (round >= 64 && e[e.length - 1] <= round - 32) break;
  }
  return k.subarray(0, 32);
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * 暗号化の鍵と辞書 (書き出しの前に create で 1 度だけ作る)。encryptObject で、書くオブジェクトの文字列とストリームを暗号化する (同期)
 */
export class PdfEncryption {
  /** 文書の ID (16 バイトの 16 進。暗号化した PDF は毎回違うバイト列になるので、中身のハッシュでなく乱数で作る) */
  readonly documentId: string;
  private constructor(
    private readonly backend: CryptoBackend,
    /** ファイルの暗号鍵 (32 バイトの乱数。Algorithm 8 の a) */
    private readonly fileKey: Uint8Array,
    private readonly entries: { O: Uint8Array; U: Uint8Array; OE: Uint8Array; UE: Uint8Array; P: number; Perms: Uint8Array },
  ) {
    this.documentId = hex(backend.random(16));
  }

  /** 鍵と暗号化の辞書の値を作る (Algorithm 8・9・10)。パスワードのエラーは KumioriOptionError (option は path の下) */
  static async create(o: PdfEncryptOptions, path = 'encrypt', backend: CryptoBackend = defaultBackend()): Promise<PdfEncryption> {
    checkEncryptOptions(o, path);
    const user = passwordBytes(o.userPassword ?? '', `${path}.userPassword`);
    // 所有者のパスワードが無ければ、乱数 (32 バイトの 16 進)。権限を外して開ける人はいない
    const owner = o.ownerPassword !== undefined ? passwordBytes(o.ownerPassword, `${path}.ownerPassword`) : new TextEncoder().encode(hex(backend.random(32)));
    const fileKey = backend.random(32);
    const zeroIv = new Uint8Array(16);
    // Algorithm 8: U = ハッシュ (利用者のパスワード, 確認のソルト) ‖ 確認のソルト ‖ 鍵のソルト。UE = ハッシュ (利用者のパスワード, 鍵のソルト) を鍵にした AES-256 (CBC・初期ベクトル 0・詰め物なし) のファイルの暗号鍵
    const uSalt = backend.random(16);
    const U = concatAll(rejoin(thisCall(), await hash2B(backend, user, uSalt.subarray(0, 8), new Uint8Array(0))), uSalt);
    const UE = backend.aesCbc(rejoin(thisCall(), await hash2B(backend, user, uSalt.subarray(8, 16), new Uint8Array(0))), zeroIv, fileKey, false);
    // Algorithm 9: O・OE は、udata に U (48 バイト) を足して同じに作る
    const oSalt = backend.random(16);
    const O = concatAll(rejoin(thisCall(), await hash2B(backend, owner, oSalt.subarray(0, 8), U)), oSalt);
    const OE = backend.aesCbc(rejoin(thisCall(), await hash2B(backend, owner, oSalt.subarray(8, 16), U)), zeroIv, fileKey, false);
    // Algorithm 10: Perms = AES-256 (ECB。1 ブロックなので、初期ベクトル 0 の CBC と同じ) で、P (32 ビットの小さい桁から) ‖ 0xFF × 4 ‖ 'T' (EncryptMetadata が true) ‖ 'adb' ‖ 乱数 4 バイト
    const P = permissionBits(o.permissions);
    const perms = new Uint8Array(16);
    new DataView(perms.buffer).setInt32(0, P, true);
    perms.fill(0xff, 4, 8);
    perms.set([0x54, 0x61, 0x64, 0x62], 8);
    perms.set(backend.random(4), 12);
    const Perms = backend.aesCbc(fileKey, zeroIv, perms, false);
    return new PdfEncryption(backend, fileKey, { O, U, OE, UE, P, Perms });
  }

  /** 権限の P の値 */
  get permissions(): number {
    return this.entries.P;
  }

  /**
   * 暗号化の辞書 (Table 20・21) を文書に足し、trailer の Encrypt に指させる。カタログには Adobe の拡張の印 (ExtensionLevel 8) を書く
   * (PDF 1.7 の見出しで AES-256 の R 6 を読めることを示す。ISO 32000-2 §7.12)
   */
  register(ctx: PDFContext, catalog: PDFDict): PDFRef {
    const e = this.entries;
    const h = (b: Uint8Array) => PDFHexString.of(hex(b));
    const dict = ctx.obj({
      Filter: 'Standard',
      V: 5,
      Length: 256,
      CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
      StmF: 'StdCF',
      StrF: 'StdCF',
      R: 6,
      O: h(e.O),
      U: h(e.U),
      OE: h(e.OE),
      UE: h(e.UE),
      P: e.P,
      Perms: h(e.Perms),
      EncryptMetadata: true,
    } as never);
    const ref = ctx.register(dict as unknown as PDFDict);
    ctx.trailerInfo.Encrypt = ref;
    // 文書の ID (trailer の ID) は、暗号化した文書では欠かせない (ISO 32000-2 §7.5.5 の Table 15・§14.4)。無ければ乱数の ID を書く
    if (!ctx.trailerInfo.ID) ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(this.documentId), PDFHexString.of(this.documentId)]);
    const ext = catalog.lookupMaybe(PDFName.of('Extensions'), PDFDict) ?? ctx.obj({});
    ext.set(PDFName.of('ADBE'), ctx.obj({ BaseVersion: PDFName.of('1.7'), ExtensionLevel: 8 } as never));
    catalog.set(PDFName.of('Extensions'), ext);
    return ref;
  }

  /** バイト列を暗号化する (AESV3: 16 バイトの乱数の初期ベクトル ‖ AES-256-CBC (PKCS#5 の詰め物)。§7.6.3.1) */
  encryptBytes(data: Uint8Array): Uint8Array {
    const iv = this.backend.random(16);
    return concatAll(iv, this.backend.aesCbc(this.fileKey, iv, data, true));
  }

  /**
   * 書くオブジェクトの文字列 (辞書・配列の中も) とストリームの中身を暗号化したものを返す (元のオブジェクトは変えない。変わらなければ同じもの)。
   * ストリームは、中身 (フィルターで符号化した後のバイト列) を暗号化し、辞書の Length を暗号化した長さにする。
   * 暗号化の辞書・相互参照のストリームには使わない (§7.6.2。呼ぶ側 (pdfWriter.ts) が除く)
   */
  encryptObject(obj: PDFObject): PDFObject {
    if (obj instanceof PDFStream) {
      // 辞書はコピーする (Length を書き換えるので、元の辞書を変えない)
      const dict = this.encryptDict(obj.dict, true);
      return PDFRawStream.of(dict, this.encryptBytes(obj.getContents()));
    }
    if (obj instanceof PDFString || obj instanceof PDFHexString) return PDFHexString.of(hex(this.encryptBytes(obj.asBytes())));
    if (obj instanceof PDFDict) return this.encryptDict(obj, false);
    if (obj instanceof PDFArray) {
      let changed = false;
      const items = obj.asArray().map((v) => {
        const w = this.encryptObject(v);
        if (w !== v) changed = true;
        return w;
      });
      if (!changed) return obj;
      const out = PDFArray.withContext((obj as unknown as { context: PDFContext }).context);
      for (const v of items) out.push(v);
      return out;
    }
    return obj;
  }

  /** 辞書の値を暗号化したもの (copy なら、変わらなくてもコピーする。ストリームの辞書の Length は、書くときに PDFRawStream が中身の長さにする) */
  private encryptDict(d: PDFDict, copy: boolean): PDFDict {
    let changed = copy;
    const entries = d.entries().map(([k, v]) => {
      const w = this.encryptObject(v);
      if (w !== v) changed = true;
      return [k, w] as const;
    });
    if (!changed) return d;
    const out = PDFDict.withContext(d.context);
    for (const [k, v] of entries) out.set(k, v);
    return out;
  }
}
