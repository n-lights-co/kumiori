/**
 * PDF の暗号化 (src/pdfEncrypt.ts。AES-256、標準セキュリティハンドラーの R 6。ISO 32000-2 §7.6)。
 *  - 自前の AES-CBC が Node の crypto と同じ結果になること (ブラウザーで使う計算の道具)
 *  - 暗号化の辞書の U・UE・O・OE・Perms が、パスワードで確認できること (Algorithm 2.A・11・12・13 を、試験の側で Node の crypto で計算する)。
 *    Node の道具と、WebCrypto と自前の AES の道具 (ブラウザーの道具) の両方で作る
 *  - 組んだ PDF を、qpdf と Poppler (pdfinfo・pdftotext) で開けること、パスワード無しでは開けないこと、権限が指定どおりなこと、
 *    戻した中身が暗号化しない PDF と同じこと (道具が無ければ飛ばす)
 *  - PDF/X・PDF/A と一緒ならエラー、PDF/UA では支援技術のための抽出の権限を残すこと、選択肢のエラー
 */
import { beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, type PDFDict } from 'pdf-lib';
import { DEFAULT_FONTS, createTypesetter, typeset, typesetToPdf, KumioriPdfError, KumioriOptionError, type Typesetter } from '../src/index';
import { aesCbcJs, defaultBackend, PdfEncryption, permissionBits, webBackend } from '../src/pdfEncrypt';
import { writePdf } from '../src/pdfWriter';
import { ensureFonts, loadCachedFont } from './helpers';
import { toolsAvailable } from '../scripts/pdf-checks-lib.mjs';
import { parseArgs, UsageError } from '../src/cli';

const tools = toolsAvailable();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-encrypt-'));
const HTML = '<!DOCTYPE html><html lang="ja"><head><title>暗号化の試験</title></head><body><h1>見出し</h1><p>吾輩は猫である。名前はまだ無い。<a href="https://example.com/">リンク</a></p></body></html>';
const DATE = new Date('2026-01-02T03:04:05Z');

/** qpdf を走らせる (終了コードと出力) */
const qpdf = (...args: string[]) => spawnSync('qpdf', args, { encoding: 'utf8' });

/** 暗号化しない PDF と比べるために、qpdf で正規化した PDF の行 (オブジェクトの番号と相互参照の位置と、暗号化の拡張の印・ID は除く) */
function normalized(file: string, password?: string): string[] {
  const out = path.join(tmp, `n-${path.basename(file)}`);
  execFileSync('qpdf', [...(password !== undefined ? [`--password=${password}`] : []), '--decrypt', '--qdf', '--object-streams=disable', '--static-id', file, out]);
  const text = fs.readFileSync(out, 'latin1');
  return text
    .replace(/\/Extensions <<\s*\/ADBE <<\s*\/BaseVersion \/1\.7\s*\/ExtensionLevel 8\s*>>\s*>>\s*/g, '')
    .replace(/uuid:[0-9a-f-]{36}/g, 'uuid:ID')
    .replace(/\/ID \[<[0-9a-f]{32}>/g, '/ID [<ID>')
    .split('\n')
    .filter((l) => !/^\d{10} \d{5} [nf] $/.test(l) && !/^startxref/.test(l) && !/^\d+$/.test(l));
}

// ---- Algorithm 2.B・11・12 (試験の側で、Node の crypto だけで計算する) ----
function hash2B(pw: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let k = crypto.createHash('sha256').update(Buffer.concat([pw, salt, udata])).digest();
  for (let round = 1; ; round++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([pw, k, udata])));
    const c = crypto.createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    c.setAutoPadding(false);
    const e = Buffer.concat([c.update(k1), c.final()]);
    const mod = [...e.subarray(0, 16)].reduce((a, b) => a + b, 0) % 3;
    k = crypto.createHash(['sha256', 'sha384', 'sha512'][mod]).update(e).digest();
    if (round >= 64 && e[e.length - 1] <= round - 32) break;
  }
  return k.subarray(0, 32);
}
const aes256Decrypt = (key: Buffer, data: Buffer) => {
  const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16));
  d.setAutoPadding(false);
  return Buffer.concat([d.update(data), d.final()]);
};
/** 暗号化の辞書の値 (16 進の文字列) */
const entry = (dict: PDFDict, key: string) => Buffer.from((dict.get(PDFName.of(key)) as PDFHexString).asBytes());

describe('自前の AES-CBC (ブラウザーで使う道具)', () => {
  it('Node の crypto と同じ結果 (AES-128・256、詰め物あり・なし、いろいろな長さ)', () => {
    for (const keyLen of [16, 32])
      for (const len of [0, 1, 15, 16, 17, 31, 32, 100, 1000])
        for (const pad of [true, false]) {
          if (!pad && len % 16) continue;
          const key = crypto.randomBytes(keyLen);
          const iv = crypto.randomBytes(16);
          const data = crypto.randomBytes(len);
          const c = crypto.createCipheriv(`aes-${keyLen * 8}-cbc`, key, iv);
          c.setAutoPadding(pad);
          const want = Buffer.concat([c.update(data), c.final()]);
          expect(Buffer.from(aesCbcJs(key, iv, data, pad)).equals(want), `${keyLen} ${len} ${pad}`).toBe(true);
        }
  });
  it('FIPS 197 の付録 C.3 の例 (AES-256)', () => {
    const key = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
    const plain = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    expect(Buffer.from(aesCbcJs(key, Buffer.alloc(16), plain, false)).toString('hex')).toBe('8ea2b7ca516745bfeafc49904b496089');
  });
});

describe('暗号化の辞書', () => {
  for (const [label, backend] of [
    ['Node の crypto', defaultBackend()],
    ['WebCrypto と自前の AES', webBackend()],
  ] as const)
    it(`${label}で作った U・UE・O・OE・Perms を、パスワードで確認できる`, async () => {
      const enc = await PdfEncryption.create({ userPassword: 'ユーザー', ownerPassword: 'owner', permissions: { print: false, copy: false } }, 'encrypt', backend);
      const pdf = await PDFDocument.create();
      const ref = enc.register(pdf.context, pdf.catalog);
      const dict = pdf.context.lookup(ref) as PDFDict;
      const [U, UE, O, OE, Perms] = ['U', 'UE', 'O', 'OE', 'Perms'].map((k) => entry(dict, k));
      expect([U.length, UE.length, O.length, OE.length, Perms.length]).toEqual([48, 32, 48, 32, 16]);
      // Algorithm 11 (利用者のパスワードの確認) と、Algorithm 2.A の UE からのファイルの暗号鍵
      const user = Buffer.from('ユーザー', 'utf8');
      expect(hash2B(user, U.subarray(32, 40), Buffer.alloc(0)).equals(U.subarray(0, 32))).toBe(true);
      expect(hash2B(Buffer.from('違う'), U.subarray(32, 40), Buffer.alloc(0)).equals(U.subarray(0, 32))).toBe(false);
      const keyU = aes256Decrypt(hash2B(user, U.subarray(40, 48), Buffer.alloc(0)), UE);
      // Algorithm 12 (所有者のパスワードの確認) と、OE からのファイルの暗号鍵 (同じ鍵)
      const owner = Buffer.from('owner');
      expect(hash2B(owner, O.subarray(32, 40), U).equals(O.subarray(0, 32))).toBe(true);
      const keyO = aes256Decrypt(hash2B(owner, O.subarray(40, 48), U), OE);
      expect(keyO.equals(keyU)).toBe(true);
      // Algorithm 13 (Perms): P と 'T' 'adb'
      const perms = aes256Decrypt(keyU, Perms);
      const P = (dict.get(PDFName.of('P')) as PDFNumber).asNumber();
      expect(perms.readInt32LE(0)).toBe(P);
      expect(perms.subarray(8, 12).toString('latin1')).toBe('Tadb');
      expect(P).toBe(permissionBits({ print: false, copy: false }));
      // 文字列とストリームの暗号化 (初期ベクトル ‖ AES-256-CBC) を、同じ鍵で戻せる
      const data = new TextEncoder().encode('Kumiori の暗号化');
      const sealed = Buffer.from(enc.encryptBytes(data));
      const d = crypto.createDecipheriv('aes-256-cbc', keyU, sealed.subarray(0, 16));
      expect(Buffer.concat([d.update(sealed.subarray(16)), d.final()]).toString('utf8')).toBe('Kumiori の暗号化');
      // カタログの Adobe の拡張の印
      const ext = (pdf.catalog.get(PDFName.of('Extensions')) as PDFDict).get(PDFName.of('ADBE')) as PDFDict;
      expect(ext.get(PDFName.of('ExtensionLevel'))?.toString()).toBe('8');
    });

  it('権限の P (ISO 32000-2 の Table 22): 既定はどれも許し、予約のビットは 1、bit 1・2 は 0', () => {
    expect(permissionBits({})).toBe(-4);
    expect(permissionBits({ print: false }) >>> 0).toBe((0xfffffffc & ~(1 << 2)) >>> 0);
    expect(permissionBits({ print: false, modify: false, copy: false, annotate: false, fillForms: false, accessibility: false, assemble: false, printHighQuality: false }) >>> 0).toBe(0xfffff0c0);
  });

  it('パスワードは SASLprep の後の UTF-8 の初めの 127 バイト (長いパスワードは切る)', async () => {
    const long = 'あ'.repeat(60); // 180 バイト
    const enc = await PdfEncryption.create({ userPassword: long });
    const pdf = await PDFDocument.create();
    const dict = pdf.context.lookup(enc.register(pdf.context, pdf.catalog)) as PDFDict;
    const U = entry(dict, 'U');
    expect(hash2B(Buffer.from(long, 'utf8').subarray(0, 127), U.subarray(32, 40), Buffer.alloc(0)).equals(U.subarray(0, 32))).toBe(true);
    // 全角の英字は NFKC で半角にする
    const enc2 = await PdfEncryption.create({ userPassword: 'ＰＡＳＳ' });
    const pdf2 = await PDFDocument.create();
    const U2 = entry(pdf2.context.lookup(enc2.register(pdf2.context, pdf2.catalog)) as PDFDict, 'U');
    expect(hash2B(Buffer.from('PASS'), U2.subarray(32, 40), Buffer.alloc(0)).equals(U2.subarray(0, 32))).toBe(true);
  });

  it('選択肢のエラー (KumioriOptionError): 形・知らない権限・使えない文字', async () => {
    const bad = async (o: unknown) => {
      const e = await PdfEncryption.create(o as never).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(KumioriOptionError);
      return (e as KumioriOptionError).option;
    };
    expect(await bad('pw')).toBe('encrypt');
    expect(await bad({ password: 'x' })).toBe('encrypt.password');
    expect(await bad({ userPassword: 1 })).toBe('encrypt.userPassword');
    expect(await bad({ permissions: { printing: false } })).toBe('encrypt.permissions.printing');
    expect(await bad({ permissions: { print: 'no' } })).toBe('encrypt.permissions.print');
    expect(await bad({ ownerPassword: 'a\u0001b' })).toBe('encrypt.ownerPassword');
  });
});

describe('暗号化した PDF', () => {
  let t: Typesetter;
  beforeAll(async () => {
    await ensureFonts([...DEFAULT_FONTS.base]);
    t = await createTypesetter({ loadFont: loadCachedFont });
  }, 300_000);

  it.skipIf(!tools.qpdf)('qpdf: パスワード無しでは開けず、利用者・所有者のパスワードで開け、権限が指定どおりで、戻した中身が暗号化しない PDF と同じ', async () => {
    const plain = path.join(tmp, 'plain.pdf');
    const enc = path.join(tmp, 'enc.pdf');
    fs.writeFileSync(plain, (await t.typesetToPdf(HTML, { pdfua: true }, { date: DATE })).pdf);
    const r = await t.typesetToPdf(HTML, { pdfua: true }, { date: DATE, encrypt: { userPassword: 'ユーザー', ownerPassword: 'owner', permissions: { print: false, copy: false, modify: false } } });
    expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    fs.writeFileSync(enc, r.pdf);
    // --requires-password: 0 はパスワードが要る
    expect(qpdf('--requires-password', enc).status).toBe(0);
    expect(qpdf('--requires-password', plain).status).toBe(2);
    expect(qpdf('--check', enc).status).not.toBe(0);
    expect(qpdf('--password=違う', '--check', enc).status).not.toBe(0);
    for (const pw of ['ユーザー', 'owner']) {
      const c = qpdf(`--password=${pw}`, '--check', enc);
      expect(c.status, c.stderr).toBe(0);
    }
    const shown = qpdf('--password=ユーザー', '--show-encryption', enc).stdout;
    expect(shown).toContain('R = 6');
    expect(shown).toContain('Supplied password is user password');
    expect(shown).toMatch(/stream encryption method: AESv3/);
    expect(shown).toMatch(/string encryption method: AESv3/);
    expect(shown).toMatch(/extract for accessibility: allowed/);
    expect(shown).toMatch(/extract for any purpose: not allowed/);
    expect(shown).toMatch(/print low resolution: not allowed/);
    expect(shown).toMatch(/modify other: not allowed/);
    expect(shown).toMatch(/modify annotations: allowed/);
    expect(shown).toMatch(/modify document assembly: allowed/);
    expect(qpdf('--password=owner', '--show-encryption', enc).stdout).toContain('Supplied password is owner password');
    // 戻した中身 (利用者・所有者のパスワードのどちらでも) が、暗号化しない PDF と同じ
    const want = normalized(plain);
    expect(normalized(enc, 'ユーザー')).toEqual(want);
    expect(normalized(enc, 'owner')).toEqual(want);
  });

  it.skipIf(!tools.pdfinfo || !tools.pdftotext)('Poppler (pdfinfo・pdftotext): パスワードで開け、無ければ開けない', async () => {
    const plainText = execFileSync('pdftotext', ['-', '-'], { input: (await t.typesetToPdf(HTML, {}, { date: DATE })).pdf }).toString();
    const enc = path.join(tmp, 'poppler.pdf');
    fs.writeFileSync(enc, (await t.typesetToPdf(HTML, {}, { date: DATE, encrypt: { userPassword: 'pass', permissions: { print: false } } })).pdf);
    const info = execFileSync('pdfinfo', ['-upw', 'pass', enc]).toString();
    expect(info).toMatch(/Encrypted:\s+yes \(print:no copy:yes change:yes addNotes:yes algorithm:AES-256\)/);
    expect(info).toMatch(/Title:\s+暗号化の試験/);
    expect(execFileSync('pdftotext', ['-upw', 'pass', enc, '-']).toString()).toBe(plainText);
    expect(spawnSync('pdftotext', [enc, '-']).status).not.toBe(0);
    expect(spawnSync('pdfinfo', [enc]).status).not.toBe(0);
  });

  it.skipIf(!tools.qpdf)('利用者のパスワードが無ければ、パスワード無しで開けて、権限だけが付く (所有者のパスワードは乱数)', async () => {
    const enc = path.join(tmp, 'nopass.pdf');
    fs.writeFileSync(enc, (await t.typesetToPdf(HTML, {}, { encrypt: { permissions: { modify: false, assemble: false } } })).pdf);
    expect(qpdf('--requires-password', enc).status).toBe(3);
    const shown = qpdf('--show-encryption', enc).stdout;
    expect(shown).toContain('Supplied password is user password');
    expect(shown).toMatch(/modify other: not allowed/);
    expect(shown).toMatch(/modify document assembly: not allowed/);
    expect(shown).toMatch(/print high resolution: allowed/);
    expect(qpdf('--check', enc).status).toBe(0);
  });

  it.skipIf(!tools.qpdf)('流して書く出力 (typesetToPdfStream・toPdfStream) と、組んだ結果の toPdf でも暗号化する', async () => {
    const want = normalized(await write('want.pdf', (await t.typesetToPdf(HTML, {}, { date: DATE })).pdf));
    const chunks: Uint8Array[] = [];
    await t.typesetToPdfStream(HTML, {}, (c) => void chunks.push(c.slice()), { date: DATE, encrypt: { userPassword: 's' } });
    expect(normalized(await write('stream.pdf', Buffer.concat(chunks)), 's')).toEqual(want);
    const res = await t.typeset(HTML);
    expect(normalized(await write('topdf.pdf', await res.toPdf({ date: DATE, encrypt: { userPassword: 'r' } })), 'r')).toEqual(normalized(await write('topdf-plain.pdf', await res.toPdf({ date: DATE }))));
    const chunks2: Uint8Array[] = [];
    await res.toPdfStream((c) => void chunks2.push(c.slice()), { date: DATE, encrypt: { userPassword: 'q' } });
    expect(qpdf('--password=q', '--check', await write('topdfstream.pdf', Buffer.concat(chunks2))).status).toBe(0);
  });

  it.skipIf(!tools.qpdf)('相互参照の表で書く PDF (オブジェクトストリームを使わない) も暗号化できる', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText('Hello', { x: 20, y: 100 });
    doc.setTitle('Table');
    const enc = await PdfEncryption.create({ userPassword: 't' });
    const bytes = await writePdf(doc, { objectStreams: false, encryption: enc });
    const file = await write('table.pdf', bytes);
    expect(qpdf('--password=t', '--check', file).status).toBe(0);
    expect(qpdf('--password=t', '--show-encryption', file).stdout).toContain('R = 6');
  });

  it('PDF/X・PDF/A と一緒なら KumioriPdfError (pdf/encrypt-incompatible)。組む前に断る', async () => {
    for (const pdf of [{ pdfa: { version: 'A-2b' as const } }, { pdfx: { version: 'X-3' as const } }]) {
      const e = await t.typesetToPdf(HTML, {}, { ...pdf, encrypt: { userPassword: 'x' } }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(KumioriPdfError);
      expect((e as KumioriPdfError).code).toBe('pdf/encrypt-incompatible');
    }
    const r = await typeset(HTML, { loadFont: loadCachedFont });
    const e = await r.toPdf({ pdfa: { version: 'A-3b' }, encrypt: {} }).catch((x: unknown) => x);
    expect((e as KumioriPdfError).code).toBe('pdf/encrypt-incompatible');
    // 選択肢の形のエラーは、組む前に KumioriOptionError (option は pdf.encrypt の下)
    const o = await typesetToPdf(HTML, { loadFont: loadCachedFont }, { encrypt: { permissions: { printing: true } } as never }).catch((x: unknown) => x);
    expect(o).toBeInstanceOf(KumioriOptionError);
    expect((o as KumioriOptionError).option).toBe('pdf.encrypt.permissions.printing');
  });

  it.skipIf(!tools.qpdf)('PDF/UA では、支援技術のための抽出の権限を外そうとしても、警告して残す', async () => {
    const r = await t.typesetToPdf(HTML, { pdfua: true }, { encrypt: { userPassword: 'u', permissions: { accessibility: false, copy: false } } });
    expect(r.diagnostics.map((d) => d.code)).toContain('pdfua/encrypt-accessibility-kept');
    const shown = qpdf('--password=u', '--show-encryption', await write('ua.pdf', r.pdf)).stdout;
    expect(shown).toMatch(/extract for accessibility: allowed/);
    expect(shown).toMatch(/extract for any purpose: not allowed/);
    // PDF/UA でなければ、外せる
    const r2 = await t.typesetToPdf(HTML, {}, { encrypt: { userPassword: 'u', permissions: { accessibility: false } } });
    expect(r2.diagnostics.map((d) => d.code)).not.toContain('pdfua/encrypt-accessibility-kept');
    expect(qpdf('--password=u', '--show-encryption', await write('noua.pdf', r2.pdf)).stdout).toMatch(/extract for accessibility: not allowed/);
  });

  it('暗号化した PDF は毎回違うバイト列で、文書の ID も乱数 (暗号化しない PDF は同じ日時なら同じバイト列のまま)', async () => {
    const a = (await t.typesetToPdf(HTML, {}, { date: DATE, encrypt: {} })).pdf;
    const b = (await t.typesetToPdf(HTML, {}, { date: DATE, encrypt: {} })).pdf;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    const p1 = (await t.typesetToPdf(HTML, {}, { date: DATE })).pdf;
    const p2 = (await t.typesetToPdf(HTML, {}, { date: DATE })).pdf;
    expect(Buffer.from(p1).equals(Buffer.from(p2))).toBe(true);
  });
});

describe('コマンドの選択肢', () => {
  it('--encrypt・--user-password・--owner-password・--deny', () => {
    expect(parseArgs(['a.html']).encrypt).toBeUndefined();
    expect(parseArgs(['a.html', '--encrypt']).encrypt).toEqual({});
    expect(parseArgs(['a.html', '--user-password', 'u', '--owner-password', 'o', '--deny', 'print,copy', '--deny', 'fill-forms']).encrypt).toEqual({
      userPassword: 'u',
      ownerPassword: 'o',
      permissions: { print: false, copy: false, fillForms: false },
    });
    expect(() => parseArgs(['a.html', '--deny', 'printing'])).toThrow(UsageError);
    expect(() => parseArgs(['a.html', '--encrypt', '--pdfa', '2b'])).toThrow(UsageError);
    expect(() => parseArgs(['a.html', '--user-password', 'u', '--pdfx', 'x4'])).toThrow(UsageError);
    expect(() => parseArgs(['a.html', '--encrypt', '--format', 'svg'])).toThrow(UsageError);
  });
});

async function write(name: string, bytes: Uint8Array): Promise<string> {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, bytes);
  return f;
}
