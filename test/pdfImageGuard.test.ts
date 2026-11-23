/**
 * PDF の画像の、圧縮を解く縛り (オブジェクトの流れ・相互参照の流れ・中身の流れ・資源の中の入れ子の Form。大きさと時間)・
 * 入れ子の Form の構造の木の項目 (StructParents と MCID を持ち込まない)・任意の内容 (PDF/A では断る)・ICC プロファイルの長い説明の文。
 * 圧縮の爆弾は、小さいうちに断ることを、かかった時間で確かめる (design/pdf-as-image.md の 4 節・2.2 節・2.3 節)
 */
import { deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { AssetStore } from '../src/assets';
import { runInCall } from '../src/callContext';
import type { Diagnostic } from '../src/diagnostics';
import { iccDescription, iccProfileProblem } from '../src/iccRegistry';
import { DEFAULT_FONTS, typeset, typesetToPdf } from '../src/index';
import { resolveLimits, type KumioriLimits } from '../src/limits';
import { decodeGuarded } from '../src/pdfStreamGuard';
import { ensureFonts, loadCachedFont } from './helpers';
import { makePdf, rawPdf } from './pdfImageFixtures';

const MB = 1024 * 1024;
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
/** 空白 n バイトを 2 度 Flate で圧縮したもの (64MB で 1KB に満たない) */
const doubleFlate = (head: string, n: number) => new Uint8Array(deflateSync(deflateSync(Buffer.concat([Buffer.from(head, 'latin1'), Buffer.alloc(n, 0x20)]))));

/** 画像の置き場で PDF を読む (上限を渡す)。診断と、当たった上限と、かかった時間を返す */
async function load(bytes: Uint8Array, limits: KumioriLimits = {}) {
  const ds: Diagnostic[] = [];
  const reached = new Set<string>();
  const assets = new AssetStore({ report: (d) => ds.push(d) });
  const t = performance.now();
  const a = await runInCall({ lang: 'en', limits: resolveLimits(limits), limitsReached: reached }, () => assets.addBlob('a.pdf', new Blob([bytes as BlobPart])));
  return { source: a?.pdfSource, ds, reached, ms: performance.now() - t };
}

describe('読み込みの縛り (オブジェクトの流れ・相互参照の流れ)', () => {
  it('二重の Flate で 64MB になるオブジェクトの流れは、解く前に縛り (ファイルの大きさの 100 倍) で断る', async () => {
    const objStm = doubleFlate('5 0 << /A 1 >>', 64 * MB);
    const pdf = rawPdf([[4, '<< /Type /ObjStm /N 1 /First 4 /Filter [/FlateDecode /FlateDecode] >>', objStm]]);
    expect(pdf.length).toBeLessThan(4096);
    const r = await load(pdf);
    expect(r.source).toBeUndefined();
    expect(r.ds.map((d) => d.code)).toEqual(['image/pdf-invalid']);
    expect(String(r.ds[0].args?.detail ?? r.ds[0].message)).toMatch(/pdfImageStreamBytes/);
    // 展開の比の縛り (1MB + 100 倍) が先に当たるので、上限 pdfImageStreamBytes に当たった記録にしない
    expect([...r.reached]).toEqual([]);
    expect(r.ms).toBeLessThan(3000);
    // 比の縛りより上限を下げれば、上限に当たった記録にする
    const low = await load(pdf, { pdfImageStreamBytes: 1000 });
    expect([...low.reached]).toEqual(['pdfImageStreamBytes']);
  });
  it('オブジェクトの流れの中のオブジェクトの数 (N) も、解く前に pdfImageObjects に入れる', async () => {
    const pdf = rawPdf([[4, '<< /Type /ObjStm /N 2000 /First 4 >>', enc('5 0 << /A 1 >>')]]);
    const r = await load(pdf, { pdfImageObjects: 1000 });
    expect(r.source).toBeUndefined();
    expect(r.ds.map((d) => d.code)).toEqual(['image/pdf-invalid']);
    expect([...r.reached]).toEqual(['pdfImageObjects']);
    // 上げれば読める
    expect((await load(pdf, { pdfImageObjects: 5000 })).source).toBeDefined();
  });
  it('解く間も時限 (pdfImageLoadMs) が効く (イベントループが止まっていても、読み手の中で止める)', async () => {
    // ASCIIHex の 8MB (解いて 4MB) のオブジェクトの流れ
    const hex = new Uint8Array(8 * MB).fill(0x32);
    hex.set(enc('3520302020'), 0);
    const pdf = rawPdf([[4, '<< /Type /ObjStm /N 1 /First 4 /Filter /ASCIIHexDecode >>', hex]]);
    const r = await load(pdf, { pdfImageLoadMs: 1 });
    expect(r.source).toBeUndefined();
    expect([...r.reached]).toEqual(['pdfImageLoadMs']);
  });
  it('相互参照の流れも、縛りの中で解く', async () => {
    const xref = doubleFlate('', 64 * MB);
    const pdf = rawPdf([[4, '<< /Type /XRef /Size 5 /W [1 2 1] /Filter [/FlateDecode /FlateDecode] >>', xref]]);
    const r = await load(pdf);
    expect(r.source).toBeUndefined();
    expect(r.ds.map((d) => d.code)).toEqual(['image/pdf-invalid']);
    expect(r.ms).toBeLessThan(3000);
  });
});

describe('埋め込むときの縛り (中身の流れ・入れ子の Form)', () => {
  beforeAll(async () => {
    await ensureFonts(DEFAULT_FONTS.base);
  }, 300_000);
  const loadFont = loadCachedFont;
  const html = '<!doctype html><html lang="ja"><head><title>t</title></head><body><p><img src="a.pdf" alt="図"></p></body></html>';
  const files = (data: Uint8Array) => [{ name: 'a.pdf', data }];
  const bomb = { bytes: doubleFlate('0 0 1 rg 0 0 10 10 re f\n', 64 * MB), filter: ['FlateDecode', 'FlateDecode'] };

  it('二重の Flate の中身の流れは、解く前・解く間に pdfImageStreamBytes で断る', async () => {
    const pdf = rawPdf([[4, '<< /Filter [/FlateDecode /FlateDecode] >>', bomb.bytes]], '/Contents 4 0 R');
    const t = performance.now();
    const r = await typesetToPdf(html, { name: 'd.html', files: files(pdf), loadFont, limits: { pdfImageStreamBytes: MB } });
    expect(performance.now() - t).toBeLessThan(10_000);
    const d = r.diagnostics.find((x) => x.code === 'image/pdf-invalid');
    expect(String(d?.args?.detail)).toMatch(/pdfImageStreamBytes/);
  });
  for (const pdfa of [false, true])
    it(`資源の中の入れ子の Form の流れも、合わせて pdfImageStreamBytes で縛る (${pdfa ? 'PDF/A の検査' : '既定の出力'})`, async () => {
      const src = await makePdf([{ nestedForm: { content: bomb } }]);
      const t = performance.now();
      const r = await typeset(html, { name: 'd.html', files: files(src), loadFont, limits: { pdfImageStreamBytes: MB } });
      await r.toPdf(pdfa ? { pdfa: { version: 'A-2b', warnings: [] } } : {});
      expect(performance.now() - t).toBeLessThan(10_000);
      const d = r.diagnostics.find((x) => x.code === 'image/pdf-invalid');
      expect(String(d?.args?.detail)).toMatch(/pdfImageStreamBytes/);
    });
});

describe('縛りで解いたものと、写した後に検査や読み手が解くものを合わせる', () => {
  beforeAll(async () => {
    await ensureFonts(DEFAULT_FONTS.base);
  }, 300_000);
  const loadFont = loadCachedFont;
  const html = '<!doctype html><html lang="ja"><head><title>t</title></head><body><p><img src="a.pdf" alt="図"></p></body></html>';
  /**
   * 出力の始まりより前を指す距離で始まる deflate (RFC 1951 §3.2.3 では壊れたデータ)。辞書を付けて圧縮し、頭を辞書の無い zlib の頭にしたもの。
   * 縛りの展開 (inflateFast) はそこで止めるが、pdf-lib の FlateStream は距離を確かめずに展開を続け、64MB になる
   */
  const farBack = () => {
    const z = deflateSync(Buffer.alloc(64 * MB, 0x20), { dictionary: Buffer.alloc(32 * 1024, 0x20), level: 9 });
    // 辞書付きの頭 (CMF・FLG・DICTID の 6 バイト) を、辞書の無い頭 (0x78 0xDA) に替える
    return new Uint8Array(Buffer.concat([Buffer.from([0x78, 0xda]), z.subarray(6)]));
  };
  /** 組んだ PDF の流れを pdf-lib で解いた長さの最大 */
  const largestStream = async (pdf: Uint8Array) => {
    const out = await PDFDocument.load(pdf);
    let max = 0;
    for (const [, o] of out.context.enumerateIndirectObjects())
      if (o instanceof PDFRawStream && o.dict.get(PDFName.of('Filter')) !== undefined) {
        try {
          max = Math.max(max, decodePDFRawStream(o).decode().length);
        } catch {
          // 解けないものは数えない
        }
      }
    return max;
  };
  it('試しの流れは、縛りの展開では 0 バイトで止まり、pdf-lib では 64MB に展開される (前提の確かめ)', async () => {
    const b = farBack();
    expect(b.length).toBeLessThan(100 * 1024);
    const doc = await PDFDocument.create();
    const dict = doc.context.obj({ Filter: 'FlateDecode' });
    expect(decodeGuarded(dict, b, MB)).toEqual(new Uint8Array(0));
    expect(decodePDFRawStream(PDFRawStream.of(dict, b)).decode().length).toBeGreaterThan(60 * MB);
  });
  for (const pdfa of [false, true]) {
    it(`資源の中の Form の流れは、縛りで解いたものに置き換えて写す (${pdfa ? 'PDF/A の検査' : '既定の出力'})`, async () => {
      const src = await makePdf([{ nestedForm: { content: { bytes: farBack(), filter: ['FlateDecode'] } } }]);
      const t = performance.now();
      const r = await typeset(html, { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont, limits: { pdfImageStreamBytes: MB } });
      const pdf = await r.toPdf(pdfa ? { pdfa: { version: 'A-2b', warnings: [] } } : {});
      expect(performance.now() - t).toBeLessThan(10_000);
      expect(await largestStream(pdf)).toBeLessThan(4 * MB);
    });
    it(`ICCBased の色空間の流れも、縛りで解いたものに置き換えて写す (${pdfa ? 'PDF/A の検査' : '既定の出力'})`, async () => {
      const src = rawPdf([[4, '<< /N 3 /Filter /FlateDecode >>', farBack()], [5, '<< >>', enc('/CS0 cs 0 0 1 sc 0 0 10 10 re f\n')]], '/Resources << /ColorSpace << /CS0 [/ICCBased 4 0 R] >> >> /Contents 5 0 R');
      const r = await typeset(html, { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont, limits: { pdfImageStreamBytes: MB } });
      const pdf = await r.toPdf(pdfa ? { pdfa: { version: 'A-2b', warnings: [] } } : {});
      expect(await largestStream(pdf)).toBeLessThan(4 * MB);
    });
  }
});

describe('入れ子の Form の構造の木の項目', () => {
  beforeAll(async () => {
    await ensureFonts(DEFAULT_FONTS.base);
  }, 300_000);
  const loadFont = loadCachedFont;
  const html = '<!doctype html><html lang="ja"><head><title>t</title></head><body><p><img src="a.pdf" alt="図"></p></body></html>';

  it('入れ子の Form の StructParents を消し、流れの MCID を外す (既定のタグ付きの出力。ISO 32000-1 §14.7.4.4)', async () => {
    const src = await makePdf([{ nestedForm: { mcid: true } }]);
    const r = await typesetToPdf(html, { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont });
    const out = await PDFDocument.load(r.pdf);
    const forms = out.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Form'));
    // 貼ったページの Form と、その中の入れ子の Form
    expect(forms.length).toBe(2);
    for (const f of forms) {
      expect(f.dict.get(PDFName.of('StructParents'))).toBeUndefined();
      expect(dec(decodePDFRawStream(f).decode())).not.toMatch(/MCID/);
    }
    // 入れ子の Form の中身は、印の付いた内容の札 (BMC) を残して描く
    expect(forms.map((f) => dec(decodePDFRawStream(f).decode())).join('\n')).toMatch(/\/P BMC 0 0 1 rg 0 0 10 10 re f EMC/);
  });
});

describe('任意の内容 (Optional Content)', () => {
  beforeAll(async () => {
    await ensureFonts(DEFAULT_FONTS.base);
  }, 300_000);
  const loadFont = loadCachedFont;
  const html = '<!doctype html><html lang="ja"><head><title>t</title></head><body><p><img src="a.pdf" alt="図"></p></body></html>';

  it('PDF/A では、任意の内容を持つページを断る (pdfa/embedded-pdf。カタログに OCProperties を書かないため)。既定の出力では埋め込む', async () => {
    const src = await makePdf([{ optionalContent: true }]);
    const r = await typeset(html, { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont });
    await r.toPdf({ pdfa: { version: 'A-2b', warnings: [] } });
    const d = r.diagnostics.filter((x) => x.code === 'pdfa/embedded-pdf');
    expect(d).toHaveLength(1);
    expect(String(d[0].args?.detail)).toMatch(/OCProperties/);
    const plain = await typesetToPdf(html, { name: 'd.html', files: [{ name: 'a.pdf', data: src }], loadFont });
    expect(plain.diagnostics.map((x) => x.code).filter((c) => /embedded-pdf|pdf-invalid/.test(c))).toEqual([]);
  });
});

describe('ICC プロファイルの説明の文', () => {
  it('desc の文が長いプロファイル (200 万バイト) でも、スタックを使い切らずに読む (ICC.1:2001-04 §6.5.17)', () => {
    const n = 2_000_000;
    const size = 144 + 12 + n + 1;
    const p = new Uint8Array(size);
    const dv = new DataView(p.buffer);
    dv.setUint32(0, size);
    p.set(enc('acsp'), 36);
    dv.setUint32(128, 1);
    p.set(enc('desc'), 132);
    dv.setUint32(136, 144);
    dv.setUint32(140, 12 + n + 1);
    p.set(enc('desc'), 144);
    dv.setUint32(152, n + 1);
    p.fill(0x61, 156, 156 + n);
    expect(iccDescription(p)).toBe('a'.repeat(n));
    expect(() => iccProfileProblem(p)).not.toThrow();
  });
});
