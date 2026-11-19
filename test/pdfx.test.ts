/**
 * 入稿用の PDF/X-4 の出力 (BACKLOG O-06): 版の印 (Info と XMP)・出力の ICC プロファイルの検査・PDF 1.6・透明・ボックス・
 * 塗り足しまでの範囲 (ページの中) の注釈とフォーム、コマンドの --pdfx・--output-profile。
 * X-3 の印そのもの (OutputIntent など) は pdfinfo.test.ts・api.test.ts で確かめる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { DOMParser } from '@xmldom/xmldom';
import { parseArgs } from '../src/cli';
import { markPdfStandard, pdfStandardOf } from '../src/pdfStandard';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';
import { encodeJpeg } from '../src/jpeg';

/** 書体を手元の置き場から読む (ネットワークを使わない) */
const loadFont = async (spec: FontSpec) => {
  const f = path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** ICC のプロファイルの頭だけのもの (色空間 space。変換の表は無い。ICC.1:2010 §7.2) */
function iccHeader(space: string): Uint8Array {
  const head = new Array(132).fill(0);
  const put = (o: number, t: string) => [...t].forEach((c, k) => (head[o + k] = c.charCodeAt(0)));
  put(12, 'prtr');
  put(16, space);
  put(20, 'Lab ');
  put(36, 'acsp');
  return Uint8Array.from(head);
}
const CMYK_PROFILE = iccHeader('CMYK');

/** 1 ページ目の注釈の数 (Annots が無いか空なら 0) */
const annotCount = (pdf: PDFDocument) => {
  const a = pdf.getPage(0).node.lookup(PDFName.of('Annots'));
  return a && 'size' in a ? (a as import('pdf-lib').PDFArray).size() : 0;
};
/** 文書の情報 (Info) の項目 */
const infoOf = (pdf: PDFDocument, key: string) => String((pdf.context.lookup(pdf.context.trailerInfo.Info) as PDFDict).get(PDFName.of(key)));
/** カタログの Metadata (XMP) の中身 */
const xmpOf = (pdf: PDFDocument) => {
  const s = pdf.catalog.lookup(PDFName.of('Metadata'));
  return s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : '';
};

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

describe('PDF/X-4 の出力 (O-06)', () => {
  const html = '<p style="opacity: 0.5; background: #c03020">半透明</p><p><a href="https://example.com/">リンク</a></p>';

  it('版の印 (Info と XMP の pdfxid:GTS_PDFXVersion)・PDF 1.6・出力の ICC プロファイルの埋め込み・TrimBox だけ・透明はそのまま', async () => {
    const r = await typesetHtml(`<title>題 &amp; "名"</title>${html}`, { loadFont });
    const warnings: string[] = [];
    const bytes = await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE, warnings } });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.6');
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(infoOf(pdf, 'GTS_PDFXVersion')).toContain('PDF/X-4');
    expect(infoOf(pdf, 'Trapped')).toBe('/False');
    const xmp = xmpOf(pdf);
    expect(xmp).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>');
    expect(xmp).toContain('<pdf:Trapped>False</pdf:Trapped>');
    expect(xmp).toContain('<rdf:li xml:lang="x-default">題 &amp; &quot;名&quot;</rdf:li>');
    expect(xmp).toMatch(/<xmpMM:DocumentID>uuid:[0-9a-f-]{36}<\/xmpMM:DocumentID>/);
    expect(xmp).toContain('<xmpMM:VersionID>1</xmpMM:VersionID>');
    // Info と XMP の日付が同じ時刻 (秒まで)
    const created = /<xmp:CreateDate>(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)Z</.exec(xmp)!;
    expect(infoOf(pdf, 'CreationDate')).toContain(`D:${created.slice(1).join('')}Z`);
    // 出力の ICC プロファイルを埋め込む
    const intent = (pdf.catalog.lookup(PDFName.of('OutputIntents')) as import('pdf-lib').PDFArray).lookup(0) as PDFDict;
    expect(intent.get(PDFName.of('DestOutputProfile'))).toBeDefined();
    // ページには TrimBox だけ (ArtBox は書かない)
    const page = pdf.getPage(0).node;
    expect(page.get(PDFName.of('TrimBox'))).toBeDefined();
    expect(page.get(PDFName.of('ArtBox'))).toBeUndefined();
    // 透明は警告しない。表の無いプロファイルなので、RGB を式で変換する警告は出る
    expect(warnings.some((w) => w.includes('透明'))).toBe(false);
    expect(warnings.some((w) => w.includes('ICC'))).toBe(true);
  });

  it('出力の ICC プロファイルが無いか CMYK でなければ、誤りとして投げる', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont });
    await expect(r.toPdf({ pdfx: { version: 'X-4' } })).rejects.toThrow(/ICC プロファイル/);
    await expect(r.toPdf({ pdfx: { version: 'X-4', profile: iccHeader('RGB ') } })).rejects.toThrow(/CMYK/);
    // 誤りの文は、組んだときの言語 (lang) で書く
    const en = await typesetHtml('<p>本文</p>', { loadFont, lang: 'en' });
    await expect(en.toPdf({ pdfx: { version: 'X-4' } })).rejects.toThrow(/requires an output ICC profile/);
    await expect(en.toPdf({ pdfx: { version: 'X-4', profile: iccHeader('RGB ') } })).rejects.toThrow(/must be a CMYK profile.*RGB/);
    // X-3 はこれまでどおり、登録名だけで出せる
    await expect(r.toPdf({ pdfx: {} })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('塗り足しまでの範囲 (BleedBox) に掛かる注釈・リンクは書かずに警告する。X-3 では透明を平らにし (白の上なので警告は無い)、題が無ければ Untitled', async () => {
    const r = await typesetHtml(html, { loadFont });
    for (const version of ['X-3', 'X-4'] as const) {
      const warnings: string[] = [];
      const pdf = await PDFDocument.load(await r.toPdf({ pdfx: { version, profile: CMYK_PROFILE, warnings } }), { updateMetadata: false });
      expect(annotCount(pdf)).toBe(0);
      expect(warnings).toContain('PDF/X では、ページの中 (塗り足しまでの範囲 BleedBox に掛かる所) の注釈・リンク・フォームの欄を書きません (リンク 1 件)');
      expect(warnings.some((w) => /透明/.test(w))).toBe(false);
      expect(pdf.getTitle()).toBe('Untitled');
    }
    // PDF/X でなければ、リンクは書く
    const plain = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    expect(annotCount(plain)).toBe(1);
    // lang: 'en' なら、英語の文で警告する
    const en = await typesetHtml(html, { loadFont, lang: 'en' });
    const enWarnings: string[] = [];
    await en.toPdf({ pdfx: { warnings: enWarnings } });
    expect(enWarnings).toContain('PDF/X: annotations, links and form fields on the pages (anything overlapping the area up to the bleed, BleedBox) are not written (1 link(s))');
  });
});

/** ページの中身の流れ (書体・画像を除く) を、展開してつなげたもの */
const contentOf = (pdf: PDFDocument) => {
  const out: string[] = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Subtype')) || obj.dict.get(PDFName.of('Length1')) || obj.dict.get(PDFName.of('N'))) continue;
    try {
      out.push(new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode()));
    } catch {
      /* 書体などの読めないストリーム */
    }
  }
  return out.join('\n');
};
/** ノセの ExtGState (OP・op が true、OPM が 1) の資源の名前 */
const overprintNames = (pdf: PDFDocument) => {
  const gs = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('ExtGState'));
  if (!(gs instanceof PDFDict)) return [];
  return gs.entries().filter(([, v]) => {
    const d = pdf.context.lookup(v) as PDFDict;
    return String(d.get(PDFName.of('OP'))) === 'true' && String(d.get(PDFName.of('op'))) === 'true' && String(d.get(PDFName.of('OPM'))) === '1';
  }).map(([k]) => k.asString());
};

describe('PDF/X の黒と灰色 (GWG 2022-R1 の R0009〜R0013)', () => {
  it('灰色は K だけの CMYK にする。PDF/X でなければ RGB のまま', async () => {
    const r = await typesetHtml('<p style="color: #333; border-bottom: 1pt solid #808080">灰色</p>', { loadFont });
    const x = contentOf(await PDFDocument.load(await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE } }), { updateMetadata: false }));
    expect(x).toMatch(/\b0 0 0 0\.8 k\b/);
    expect(x).not.toMatch(/\d g\b|\d G\b/);
    const plain = contentOf(await PDFDocument.load(await r.toPdf(), { updateMetadata: false }));
    expect(plain).toMatch(/\b0\.2 0\.2 0\.2 rg\b/);
  });

  it('K だけの黒の 12pt 未満の字・2pt 未満の線にノセを付ける。大きい字・太い線・黒でない色・PDF/X でない出力には付けない', async () => {
    /** ノセの ExtGState を選んだ塊 (q … Q) ごとの中身: 字なら字の大きさ (Tf)、そうでなければ 'line' */
    const overprinted = async (html: string, pdfx = true) => {
      const pdf = await PDFDocument.load(await (await typesetHtml(html, { loadFont })).toPdf(pdfx ? { pdfx: { version: 'X-4', profile: CMYK_PROFILE } } : {}), { updateMetadata: false });
      const names = overprintNames(pdf);
      const blocks = contentOf(pdf).split(/\nQ\n/);
      return blocks
        .filter((b) => names.some((n) => b.includes(`${n} gs`)))
        .map((b) => {
          const tf = /([\d.]+) Tf/.exec(b.slice(b.lastIndexOf(' gs')));
          return tf ? Math.round(Number(tf[1])) : 'line';
        });
    };
    // 小さい黒字 (10pt) と、ノンブル (既定のスタイルの 9pt の黒字)
    expect(await overprinted('<p style="font-size: 10pt; color: #000">小さい字</p>')).toEqual([10, 9]);
    // 大きい字 (14pt)・黒でない色・白い字 (背景は黒) には付けない (付くのはノンブルだけ)
    expect(await overprinted('<p style="font-size: 14pt">大きい字</p>')).toEqual([9]);
    expect(await overprinted('<p style="font-size: 10pt; color: #c03020">色の字</p>')).toEqual([9]);
    expect(await overprinted('<p style="font-size: 10pt; color: #fff; background: #000">白い字</p>')).toEqual([9]);
    // 細い黒の罫線 (1pt) には付け、太い線 (3pt) には付けない
    expect(await overprinted('<p style="font-size: 14pt; border-bottom: 1pt solid black">罫線</p>')).toEqual(['line', 9]);
    expect(await overprinted('<p style="font-size: 14pt; border-bottom: 3pt solid black">太い線</p>')).toEqual([9]);
    // PDF/X でなければ付けない
    expect(await overprinted('<p style="font-size: 10pt">小さい字</p>', false)).toEqual([]);
  });
});

describe('入稿の仕様 GWG 2022-R1 の検査 (pdfCheck.ts)', () => {
  it('仕上がりの大きさの違い (R0004)・特色 (R0020)・画像の解像度 (R0031) を警告にする', async () => {
    const { gwgWarnings } = await import('../src/pdfCheck');
    const A4 = { width: 595.28, height: 841.89 };
    const img = (src: string, px: number, placedPt: number) => ({ src, pixels: { width: px, height: px }, placed: { width: placedPt, height: placedPt } });
    expect(gwgWarnings({ trimSizes: [A4, A4], images: [img('a.jpg', 300, 72)], spots: ['All'] })).toEqual([]);
    const w = gwgWarnings({
      trimSizes: [A4, { width: 419.53, height: 595.28 }, A4],
      // 100ppi (誤り)、200ppi (警告)、16 画素以下は調べない
      images: [img('low.jpg', 100, 72), img('mid.jpg', 200, 72), img('icon.png', 16, 72), img(`data:image/png;base64,${'A'.repeat(80)}`, 100, 72)],
      // All・None・Black などは特色に数えない (I00003)
      spots: ['All', 'None', 'Black', 'Ink A', 'Ink A', 'Ink B'],
    });
    expect(w).toEqual([
      'GWG 2022 (SheetCMYK、R0004): ページの仕上がりの大きさ (TrimBox) が、ページによって違います (210×297mm・148×210mm)。入稿では、全ページを同じ大きさにします',
      'GWG 2022 (SheetCMYK、R0020): 特色を使っています (Ink A・Ink B)。この用途では、特色は使えません',
      'GWG 2022 (SheetCMYK、R0031): 画像 low.jpg の実際の解像度が 100ppi です。149ppi を超える解像度が要ります (224ppi を超える解像度を勧めます)',
      'GWG 2022 (SheetCMYK、R0031): 画像 mid.jpg の実際の解像度が 200ppi です。224ppi を超える解像度を勧めます',
      'GWG 2022 (SheetCMYK、R0031): 画像 (文書に埋め込まれた画像) の実際の解像度が 100ppi です。149ppi を超える解像度が要ります (224ppi を超える解像度を勧めます)',
    ]);
  });

  it('PDF/X の出力で、粗い画像を警告する', async () => {
    const { encodeJpeg } = await import('../src/jpeg');
    const n = 100;
    const jpg = encodeJpeg({ width: n, height: n, components: 3, data: new Uint8Array(n * n * 3).fill(128) }, { quantScale: 0.5 });
    const r = await typesetHtml('<img src="p.jpg" style="width: 1in; height: 1in">', { loadFont, files: [{ name: 'p.jpg', data: jpg }] });
    const warnings: string[] = [];
    await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE, warnings } });
    expect(warnings.filter((w) => w.includes('R0031'))).toEqual(['GWG 2022 (SheetCMYK、R0031): 画像 p.jpg の実際の解像度が 100ppi です。149ppi を超える解像度が要ります (224ppi を超える解像度を勧めます)']);
  });
});

describe('コマンドの --pdfx・--output-profile・--output-condition', () => {
  it('版を読み、x4 には ICC プロファイルを求める', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kumiori-pdfx-'));
    const icc = path.join(dir, 'out.icc');
    fs.writeFileSync(icc, CMYK_PROFILE);
    expect(parseArgs(['a.html', '--pdfx', 'x3']).pdfx).toBe('X-3');
    expect(parseArgs(['a.html', '--pdfx', 'PDF/X-4', '--output-profile', icc]).pdfx).toBe('X-4');
    const a = parseArgs(['a.html', '--pdfx', 'x4', '--output-profile', icc, '--output-condition', 'JC201103']);
    expect(a.outputProfile).toEqual(CMYK_PROFILE);
    expect(a.outputCondition).toBe('JC201103');
    expect(() => parseArgs(['a.html', '--pdfx', 'x4'])).toThrow(/--output-profile/);
    expect(() => parseArgs(['a.html', '--pdfx', 'x5'])).toThrow(/--pdfx/);
    expect(() => parseArgs(['a.html', '--output-profile', icc])).toThrow(/--pdfx/);
    expect(() => parseArgs(['a.html', '--pdfx', 'x3', '--output-profile', path.join(dir, 'none.icc')])).toThrow(/読めません/);
    // PDF/X-1a (:2001 が既定、:2003 も選べる。プロファイルは要らない)
    expect(parseArgs(['a.html', '--pdfx', 'x1a']).pdfx).toBe('X-1a');
    expect(parseArgs(['a.html', '--pdfx', 'PDF/X-1a:2001']).pdfx).toBe('X-1a');
    expect(parseArgs(['a.html', '--pdfx', 'x1a:2003']).pdfx).toBe('X-1a:2003');
  });
});

describe('PDF/X-1a の出力', () => {
  const html = '<title>見本</title><h1 style="color: #c03020">見出し</h1><p style="background: linear-gradient(90deg, #f00, #00f)">色の段落</p><p><a href="https://example.com/">リンク</a></p>';

  it('PDF/X-1a:2001: PDF 1.3、GTS_PDFXVersion と GTS_PDFXConformance、TrimBox だけ、XMP を書かない。書き出した PDF の検査に通る', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const r = await typesetHtml(html, { loadFont });
    const warnings: string[] = [];
    const bytes = await r.toPdf({ pdfx: { version: 'X-1a', warnings } });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.3');
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(infoOf(pdf, 'GTS_PDFXVersion')).toContain('PDF/X-1:2001');
    expect(infoOf(pdf, 'GTS_PDFXConformance')).toContain('PDF/X-1a:2001');
    expect(pdf.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(pdf.getPage(0).node.get(PDFName.of('ArtBox'))).toBeUndefined();
    // 印刷条件は登録名だけ (プロファイルは埋め込まない)
    const intent = (pdf.catalog.lookup(PDFName.of('OutputIntents')) as import('pdf-lib').PDFArray).lookup(0) as PDFDict;
    expect(String(intent.get(PDFName.of('OutputConditionIdentifier')))).toContain('JC200103');
    expect(intent.get(PDFName.of('DestOutputProfile'))).toBeUndefined();
    expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
    expect(warnings).toEqual(['PDF/X では、ページの中 (塗り足しまでの範囲 BleedBox に掛かる所) の注釈・リンク・フォームの欄を書きません (リンク 1 件)']);
  });

  it('PDF/X-1a:2003: PDF 1.4、GTS_PDFXVersion が PDF/X-1a:2003 (GTS_PDFXConformance は書かない)', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const bytes = await (await typesetHtml(html, { loadFont })).toPdf({ pdfx: { version: 'X-1a:2003' } });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(infoOf(pdf, 'GTS_PDFXVersion')).toContain('PDF/X-1a:2003');
    expect(infoOf(pdf, 'GTS_PDFXConformance')).toBe('undefined');
    expect(await verifyPdfX1a(bytes, 'X-1a:2003')).toEqual([]);
  });

  it('透明を使う文書は、透明を平らにして出す (平らにした PDF は、書き出した後の検査に通る)', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    for (const body of ['<p style="opacity: 0.5">半透明</p>', '<p style="color: rgba(0, 0, 0, 0.5)">半透明の字</p>']) {
      const bytes = await (await typesetHtml(body, { loadFont })).toPdf({ pdfx: { version: 'X-1a' } });
      expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
    }
  });

  it('検査は、ふつうの PDF の違反 (版・印・出力意図・ボックス・注釈・RGB の色) を見つける', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const problems = await verifyPdfX1a(await (await typesetHtml(html, { loadFont })).toPdf(), 'X-1a:2001');
    for (const p of [/PDF の版が 1\.7/, /GTS_PDFXVersion/, /GTS_PDFXConformance/, /Trapped/, /出力意図/, /TrimBox か ArtBox/, /注釈 \(Link\)/, /RGB の色 \(rg・RG\)/]) {
      expect(problems.some((x) => p.test(x))).toBe(true);
    }
  });

  it('出力の ICC プロファイルを渡すなら、CMYK のものに限る', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont });
    await expect(r.toPdf({ pdfx: { version: 'X-1a', profile: iccHeader('RGB ') } })).rejects.toThrow(/PDF\/X-1a の出力の ICC プロファイルは、CMYK/);
    await expect(r.toPdf({ pdfx: { version: 'X-1a', profile: CMYK_PROFILE } })).resolves.toBeInstanceOf(Uint8Array);
  });
});

// 灰色だけの画像 (画素がすべて R = G = B) は、PDF/X でも DeviceGray で書く (pdfStandard.ts の PdfStandard.cmyk)。前は 8 ビットの灰色 (色の型 0) の
// PNG のほかを DeviceRGB で書いていたので、PDF/X-1a・X-3 の検査で止まり、X-4 にも RGB の画像が残っていた
describe('PDF/X の灰色だけの画像', () => {
  /** 生の PNG (フィルタ 0 の行を zlib で包む。PNG 1.2 §11.2) */
  const rawPng = (w: number, h: number, depth: number, colorType: number, row: (y: number) => number[]) => {
    const chunk = (type: string, body: Uint8Array) => {
      const out = Buffer.alloc(12 + body.length);
      out.writeUInt32BE(body.length, 0);
      out.write(type, 4, 'latin1');
      Buffer.from(body).copy(out, 8);
      out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
      return out;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr.set([depth, colorType, 0, 0, 0], 8);
    const raw = Buffer.concat(Array.from({ length: h }, (_, y) => Buffer.from([0, ...row(y)])));
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', new Uint8Array(0))]));
  };
  const W = 8;
  const v = (x: number, y: number) => (x * 29 + y * 61) % 256;
  const cases: Record<string, Uint8Array> = {
    'RGB の灰色': rawPng(W, W, 8, 2, (y) => Array.from({ length: W }, (_, x) => [v(x, y), v(x, y), v(x, y)]).flat()),
    'RGBA の灰色 (不透明)': rawPng(W, W, 8, 6, (y) => Array.from({ length: W }, (_, x) => [v(x, y), v(x, y), v(x, y), 255]).flat()),
    '16 ビットの灰色': rawPng(W, W, 16, 0, (y) => Array.from({ length: W }, (_, x) => [v(x, y), 0]).flat()),
    '1 ビットの灰色': rawPng(W, W, 1, 0, (y) => [y % 2 ? 0xaa : 0x55]),
    '灰色 + α (不透明)': rawPng(W, W, 8, 4, (y) => Array.from({ length: W }, (_, x) => [v(x, y), 255]).flat()),
    'RGB の灰色の JPEG': encodeJpeg({ width: W, height: W, components: 3, data: new Uint8Array(Array.from({ length: W * W }, (_, i) => [v(i % W, i >> 3), v(i % W, i >> 3), v(i % W, i >> 3)]).flat()) }),
  };
  /** 画像の XObject の ColorSpace と、1 つ目の画像の画素 (展開したもの) */
  const imagesOf = async (bytes: Uint8Array) => {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    return pdf.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream && String(o.dict.get(PDFName.of('Subtype'))) === '/Image')
      .map((o) => ({ cs: String(o.dict.get(PDFName.of('ColorSpace'))), filter: String(o.dict.get(PDFName.of('Filter'))), data: o.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode' ? decodePDFRawStream(o).decode() : undefined }));
  };
  for (const [name, data] of Object.entries(cases)) {
    it(`${name}: X-1a・X-3・X-4 で DeviceGray にし、X-1a・X-3 の検査に通る`, async () => {
      const { verifyPdfX1a, verifyPdfX3 } = await import('../src/pdfxVerify');
      const kind = name.includes('JPEG') ? 'jpg' : 'png';
      const r = await typesetHtml(`<p><img src="g.${kind}" style="width: 40pt"></p>`, { loadFont, files: [{ name: `g.${kind}`, data }] });
      for (const version of ['X-1a', 'X-3', 'X-4'] as const) {
        const bytes = await r.toPdf({ pdfx: { version, ...(version === 'X-4' ? { profile: CMYK_PROFILE } : {}), warnings: [] } });
        const imgs = await imagesOf(bytes);
        expect(imgs.length).toBe(1);
        expect(imgs[0].cs).toBe('/DeviceGray');
        if (version === 'X-1a') expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
        if (version === 'X-3') expect(await verifyPdfX3(bytes)).toEqual([]);
        // 濃さは変えない: 灰色の値は、元の R (= G = B) の成分そのもの
        if (kind === 'png' && !name.startsWith('1 ') && imgs[0].data) expect([...imgs[0].data.slice(0, W)]).toEqual(Array.from({ length: W }, (_, x) => v(x, 0)));
      }
    });
  }
  it('PDF/X でない出力の埋め込み方は変えない (RGB の灰色の PNG は DeviceRGB のまま)', async () => {
    const r = await typesetHtml('<p><img src="g.png" style="width: 40pt"></p>', { loadFont, files: [{ name: 'g.png', data: cases['RGB の灰色'] }] });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const cs = pdf.context.enumerateIndirectObjects().map(([, o]) => o).filter((o): o is PDFRawStream => o instanceof PDFRawStream && String(o.dict.get(PDFName.of('Subtype'))) === '/Image').map((o) => String(o.dict.get(PDFName.of('ColorSpace'))));
    expect(cs).toEqual(['/DeviceRGB']);
  });
});

/** XMP を XML として読み (誤りがあれば投げる)、XML 1.0 で使えない字 (§2.2 の Char に入らない字) が無いことを確かめる */
const readXmp = (xmp: string) => {
  expect(xmp.match(/[^\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu) ?? []).toEqual([]);
  const doc = new DOMParser({
    onError: (level, m) => {
      if (level !== 'warning') throw new Error(m);
    },
  }).parseFromString(xmp.replace(/^<\?xpacket[^>]*\?>\n?/, '').replace(/\n?<\?xpacket[^>]*\?>$/, ''), 'application/xml');
  const text = (tag: string) => doc.getElementsByTagName(tag)[0]?.textContent ?? undefined;
  return { title: text('dc:title'), author: text('dc:creator'), subject: text('dc:description'), keywords: text('pdf:Keywords') };
};
/** Info のテキスト文字列の値 (無ければ undefined) */
const infoTextOf = (pdf: PDFDocument, key: string) => {
  const v = (pdf.context.lookup(pdf.context.trailerInfo.Info) as PDFDict).lookup(PDFName.of(key));
  return v && 'decodeText' in v ? (v as import('pdf-lib').PDFHexString).decodeText() : undefined;
};

describe('PDF/X-4 の XMP に、XML 1.0 で使えない字を書かない', () => {
  it('題の制御文字・U+FFFE・U+FFFF を除き、Info の題も同じ値にする', async () => {
    const r = await typesetHtml('<title>a&#1;b&#x1F;c&#xFFFE;d&#xFFFF;e</title><p>本文</p>', { loadFont });
    const pdf = await PDFDocument.load(await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE } }), { updateMetadata: false });
    const x = readXmp(xmpOf(pdf));
    expect(x.title).toBe('abcde');
    expect(infoTextOf(pdf, 'Title')).toBe('abcde');
  });

  it('普通の題 (和文・絵文字・& < > " \') は壊さない', async () => {
    const title = '日本語の題 😀 & <b> "q" \'s\'';
    const r = await typesetHtml(`<title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title><p>本文</p>`, { loadFont });
    const pdf = await PDFDocument.load(await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE } }), { updateMetadata: false });
    expect(readXmp(xmpOf(pdf)).title).toBe(title);
    expect(infoTextOf(pdf, 'Title')).toBe(title);
  });

  // 対になっていないサロゲートは、pdf-lib が Info に書くときに U+FFFD にする (XML で使える字なので、そのまま XMP にも書く)
  it('作者・主題・キーワードも、使えない字を除いて、Info と XMP を同じ値にする。タブ・改行・復帰は残す', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage();
    pdf.setTitle('\u0001');
    pdf.setAuthor('作者\u0000名\ud800');
    pdf.setSubject('主題\t1\r\n2\udc00');
    pdf.setKeywords(['k\u0008w', '😀']);
    pdf.setProducer('p');
    pdf.setCreator('c');
    markPdfStandard(pdf, pdfStandardOf({ version: 'X-4' })!, { version: 'X-4', profile: CMYK_PROFILE });
    const out = await PDFDocument.load(await pdf.save({ useObjectStreams: false }), { updateMetadata: false });
    const x = readXmp(xmpOf(out));
    expect(x).toEqual({ title: 'Untitled', author: '作者名\ufffd', subject: '主題\t1\r\n2\ufffd', keywords: 'kw 😀' });
    for (const [key, v] of [['Title', x.title], ['Author', x.author], ['Subject', x.subject], ['Keywords', x.keywords]] as const) expect(infoTextOf(out, key), key).toBe(v);
  });

  it('PDF/X でない PDF の Info の題は、これまでどおり、字を除かない', async () => {
    const r = await typesetHtml('<title>a&#1;b</title><p>本文</p>', { loadFont });
    const pdf = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    expect(infoTextOf(pdf, 'Title')).toBe('a\u0001b');
  });
});

/** 1 ページ目の画像 (XObject の Image) の辞書と画素 */
const pageImages = (pdf: PDFDocument) => {
  const xo = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'));
  if (!(xo instanceof PDFDict)) return [];
  return xo
    .entries()
    .map(([, ref]) => pdf.context.lookup(ref))
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream && String(s.dict.get(PDFName.of('Subtype'))) === '/Image')
    .map((s) => ({ dict: s.dict, width: Number(String(s.dict.get(PDFName.of('Width')))), height: Number(String(s.dict.get(PDFName.of('Height')))), data: decodePDFRawStream(s).decode() }));
};
/** 内容の流れの CMYK の塗りの色 (k) */
const fillCmyks = (text: string) => [...text.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) k\b/g)].map((m) => m.slice(1, 5).map(Number));
const near = (a: number[], b: number[], eps = 1e-4) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);
/** 1 色の PNG (RGBA) */
const solidPng = async (w: number, h: number, rgba: (x: number, y: number) => [number, number, number, number]) => {
  const { encodePngStored } = await import('../src/pixels');
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(rgba(x, y), (y * w + x) * 4);
  return `data:image/png;base64,${Buffer.from(encodePngStored({ width: w, height: h, rgba: data })).toString('base64')}`;
};

describe('PDF/X-1a の透明を平らにする処理', () => {
  const page = '<style>@page { size: 100mm 70mm; margin: 5mm }</style>';
  /** 透明度 a (CSS の色の 8 ビットの透明度に丸めたもの) */
  const a8 = (a: number) => Math.round(a * 255) / 255;

  it('下が 1 色の塗り・ページの白なら、ベクタのまま合成した CMYK の色で描く (半透明の背景・字・罫、透明のグループ)', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const { rgbToCmyk } = await import('../src/pdfRenderer');
    const html = `${page}<div style="background: rgba(0, 128, 255, 0.3); padding: 6pt"><span style="color: rgba(200, 0, 0, 0.5)">字 Text</span></div>
      <div style="background: #ffcc00; padding: 6pt"><div style="opacity: 0.6; background: #cc0000; color: white; padding: 4pt">重なる子のグループ</div></div>
      <div style="border: 4pt solid rgba(0, 0, 0, 0.4); padding: 4pt">半透明の罫</div>`;
    const warnings: string[] = [];
    const bytes = await (await typesetHtml(html, { loadFont })).toPdf({ pdfx: { version: 'X-1a', warnings } });
    expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    // 画像にしない (平らにした警告も無い)
    expect(pageImages(pdf)).toEqual([]);
    expect(warnings.filter((w) => /平らに/.test(w))).toEqual([]);
    const ks = fillCmyks(contentOf(pdf));
    const blue = rgbToCmyk(0, 128 / 255, 1);
    // 白の上の 30% の背景: Cr = αs·Cs (ISO 32000-2 §11.3.3。白は CMYK 0)
    expect(ks.some((k) => near(k, blue.map((v) => v * a8(0.3))))).toBe(true);
    // 半透明の背景の上の 50% の字: Cr = (1 − αs)·Cb + αs·Cs
    const bg = blue.map((v) => v * a8(0.3));
    const red = rgbToCmyk(200 / 255, 0, 0);
    expect(ks.some((k) => near(k, red.map((v, i) => (1 - a8(0.5)) * bg[i] + a8(0.5) * v)))).toBe(true);
    // 不透明度 0.6 のグループの中の赤の背景と白の字は、どちらも外の黄の上に 60% で重ねた色 (字の下の赤は、字に覆われる)
    const yellow = rgbToCmyk(1, 0.8, 0);
    const over = (c: number[]) => c.map((v, i) => 0.4 * yellow[i] + 0.6 * v);
    expect(ks.some((k) => near(k, over(rgbToCmyk(0.8, 0, 0))))).toBe(true);
    expect(ks.some((k) => near(k, over([0, 0, 0, 0])))).toBe(true);
    // 白の上の 40% の黒の罫 (K だけ)
    expect(ks.some((k) => near(k, [0, 0, 0, a8(0.4)]))).toBe(true);
  });

  it('下に画像・グラデーションなどがあれば、その範囲を CMYK の画像 (透明度なし) にする。画像の中の色は、CMYK で合成した色', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const { rgbToCmyk } = await import('../src/pdfRenderer');
    const img = await solidPng(4, 4, () => [30, 120, 200, 255]);
    const html = `${page}<div style="position: relative; height: 120pt"><img src="${img}" style="width: 200pt; height: 100pt">
      <div style="position: absolute; top: 20pt; left: 40pt; width: 100pt; height: 50pt; background: rgba(255, 255, 0, 0.5)"></div></div>`;
    const warnings: string[] = [];
    const bytes = await (await typesetHtml(html, { loadFont })).toPdf({ pdfx: { version: 'X-1a', warnings } });
    expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const raster = pageImages(pdf).filter((im) => String(im.dict.get(PDFName.of('ColorSpace'))) === '/DeviceCMYK' && im.width > 100);
    expect(raster).toHaveLength(1);
    const r = raster[0];
    expect(r.dict.get(PDFName.of('SMask'))).toBeUndefined();
    // 100pt × 50pt を 300ppi で
    expect(r.width).toBe(Math.ceil((100 * 300) / 72));
    const i = (Math.floor(r.height / 2) * r.width + Math.floor(r.width / 2)) * 4;
    const got = [...r.data.slice(i, i + 4)].map((v) => v / 255);
    const exp = rgbToCmyk(30 / 255, 120 / 255, 200 / 255).map((v, k) => (1 - a8(0.5)) * v + a8(0.5) * [0, 0, 1, 0][k]);
    got.forEach((v, k) => expect(Math.abs(v - exp[k])).toBeLessThan(2 / 255));
    expect(warnings).toContain('PDF/X-1a: 透明を平らにするため、1 か所 (1 ページ目) を画像 (300ppi 以上) にしました');
  });

  it('透明度つきの PNG は埋め込まず、下の物と合わせて画像にする。字の掛かる所は 600ppi にして、字の質の落ちることを警告に書く', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const img = await solidPng(8, 8, (x) => [30, 120, 200, Math.round((255 * x) / 7)]);
    const html = `${page}<div style="background: #ffeedd; padding: 6pt"><img src="${img}" style="width: 60pt; height: 30pt"></div>
      <div style="position: relative"><span style="font-size: 10pt">下の字</span><div style="position: absolute; top: 0; left: 0; width: 60pt; height: 20pt; background: rgba(0, 0, 255, 0.2)"></div></div>`;
    const warnings: string[] = [];
    const bytes = await (await typesetHtml(html, { loadFont })).toPdf({ pdfx: { version: 'X-1a', warnings } });
    expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const images = pageImages(pdf);
    expect(images.every((im) => !im.dict.get(PDFName.of('SMask')))).toBe(true);
    // 透明度つきの PNG の範囲 (60pt × 30pt。300ppi) と、字の掛かる範囲 (60pt × 20pt。600ppi)
    expect(images.map((im) => im.width).sort((p, q) => p - q)).toEqual([250, 500]);
    expect(warnings).toContain('PDF/X-1a: 透明を平らにするため、2 か所 (1 ページ目) を画像 (300ppi 以上) にしました');
    expect(warnings.some((w) => /画像にした所に字が掛かっています \(1 ページ目\)/.test(w))).toBe(true);
  });

  it('SVG: 半透明の図形の下が 1 色ならベクタのまま、重なる半透明の図形は SVG の範囲を画像にする', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const svg = (body: string) => `${page}<svg width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#ffffee"/>${body}</svg>`;
    const simple = await (await typesetHtml(svg('<rect x="10" y="10" width="80" height="80" fill="green" fill-opacity="0.4"/><text x="100" y="60" fill="purple" fill-opacity="0.5" font-size="20">字</text>'), { loadFont })).toPdf({ pdfx: { version: 'X-1a' } });
    expect(await verifyPdfX1a(simple, 'X-1a:2001')).toEqual([]);
    expect(pageImages(await PDFDocument.load(simple, { updateMetadata: false }))).toEqual([]);
    const overlap = await (await typesetHtml(svg('<circle cx="70" cy="50" r="40" fill="red" fill-opacity="0.5"/><circle cx="130" cy="50" r="40" fill="blue" opacity="0.5"/>'), { loadFont })).toPdf({ pdfx: { version: 'X-1a' } });
    expect(await verifyPdfX1a(overlap, 'X-1a:2001')).toEqual([]);
    expect(pageImages(await PDFDocument.load(overlap, { updateMetadata: false }))).toHaveLength(1);
  });

  it('透明のグループの中の子が重なり、下が 1 色でないときは、グループの全体を画像にする', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const html = `${page}<div style="background: linear-gradient(90deg, #fee, #eef); padding: 6pt"><div style="opacity: 0.5; background: #c00; color: white; padding: 4pt">グループ</div></div>`;
    const warnings: string[] = [];
    const bytes = await (await typesetHtml(html, { loadFont })).toPdf({ pdfx: { version: 'X-1a', warnings } });
    expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
    expect(pageImages(await PDFDocument.load(bytes, { updateMetadata: false }))).toHaveLength(1);
    expect(warnings.some((w) => /1 か所 \(1 ページ目\) を画像/.test(w))).toBe(true);
  });

  it('グラデーションの上の半透明の字は、字ごとにせず、行ごとに 1 つの画像にまとめる', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const html = `${page}<div style="background: linear-gradient(90deg, #fee, #eef); width: 200pt"><p style="color: rgba(0, 0, 0, 0.6); font-size: 14pt; line-height: 2; margin: 0">一行目の字 Text</p><p style="color: rgba(0, 0, 0, 0.6); font-size: 14pt; line-height: 2; margin: 0">二行目の字</p></div>`;
    const warnings: string[] = [];
    const bytes = await (await typesetHtml(html, { loadFont })).toPdf({ pdfx: { version: 'X-1a', warnings } });
    expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
    const images = pageImages(await PDFDocument.load(bytes, { updateMetadata: false }));
    expect(images).toHaveLength(2);
    expect(warnings).toContain('PDF/X-1a: 透明を平らにするため、2 か所 (1 ページ目) を画像 (300ppi 以上) にしました');
  });

  it('回した箱の背景 (凸の形の 1 色の塗り) の上の半透明の字・塗りも、ベクタのまま平らにする', async () => {
    const { verifyPdfX1a } = await import('../src/pdfxVerify');
    const html = `${page}<div style="transform: rotate(15deg); margin: 30pt; width: 150pt; background: #ffeecc; border-radius: 6pt; padding: 6pt"><span style="color: rgba(0, 0, 160, 0.5)">回した字</span><div style="background: rgba(255, 0, 0, 0.3); height: 10pt"></div></div>`;
    const warnings: string[] = [];
    const bytes = await (await typesetHtml(html, { loadFont })).toPdf({ pdfx: { version: 'X-1a', warnings } });
    expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
    expect(pageImages(await PDFDocument.load(bytes, { updateMetadata: false }))).toEqual([]);
    expect(warnings.filter((w) => /平らに/.test(w))).toEqual([]);
  });

  it('平らにできない透明が残れば、誤りとして投げる (画像にできない、繰り返しの多い背景画像の上の半透明)', async () => {
    const img = await solidPng(1, 1, () => [255, 0, 0, 255]);
    const html = `${page}<div style="position: relative; height: 150pt; background: url(${img}) repeat; background-size: 1pt 1pt"><div style="position: absolute; top: 0; left: 0; width: 50pt; height: 50pt; background: rgba(0, 0, 0, 0.5)"></div></div>`;
    const r = await typesetHtml(html, { loadFont });
    await expect(r.toPdf({ pdfx: { version: 'X-1a' } })).rejects.toThrow(/PDF\/X-1a では透明を使えないので平らにしますが、平らにできない透明が残りました:[\s\S]*1 ページ目: 透明な物の下に、繰り返しの多い背景画像があるので[\s\S]*PDF\/X-4 を使ってください/);
    // PDF/X-4 では透明のまま出せる
    await expect(r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE } })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('PDF/X でない出力・PDF/X-4 は、透明を平らにしない (透明のまま)', async () => {
    const r = await typesetHtml(`${page}<p style="opacity: 0.5; background: #c03020">半透明</p><p style="color: rgba(0, 0, 0, 0.5)">半透明の字</p>`, { loadFont });
    for (const bytes of [await r.toPdf(), await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE } })]) {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      const gs = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('ExtGState'));
      const cas = gs instanceof PDFDict ? gs.entries().map(([, v]) => String((pdf.context.lookup(v) as PDFDict).get(PDFName.of('ca')))) : [];
      expect(cas).toContain('0.5');
      expect(contentOf(pdf)).toMatch(/\/KmG\S* Do/);
    }
  });
});

describe('PDF/X-3 の透明を平らにする処理と検査', () => {
  const page = '<style>@page { size: 100mm 70mm; margin: 5mm }</style>';

  it('PDF/X-3 も透明を平らにし (X-1a と同じ)、書き出した後の検査に通る。PDF 1.4、GTS_PDFXVersion は PDF/X-3:2003', async () => {
    const { verifyPdfX3 } = await import('../src/pdfxVerify');
    const img = await solidPng(4, 4, () => [30, 120, 200, 255]);
    const html = `${page}<p style="opacity: 0.5; background: #c03020">半透明</p><p style="color: rgba(0, 0, 0, 0.5)">半透明の字</p>
      <div style="position: relative; height: 60pt"><img src="${img}" style="width: 100pt; height: 50pt"><div style="position: absolute; top: 10pt; left: 20pt; width: 50pt; height: 20pt; background: rgba(255, 255, 0, 0.5)"></div></div>`;
    const warnings: string[] = [];
    const bytes = await (await typesetHtml(html, { loadFont })).toPdf({ pdfx: { version: 'X-3', warnings } });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    expect(await verifyPdfX3(bytes)).toEqual([]);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(infoOf(pdf, 'GTS_PDFXVersion')).toContain('PDF/X-3:2003');
    // 白の上の半透明はベクタのまま、画像の上の半透明は画像にする (透明度なしの CMYK)
    const images = pageImages(pdf).filter((im) => im.width > 100);
    expect(images).toHaveLength(1);
    expect(images[0].dict.get(PDFName.of('SMask'))).toBeUndefined();
    expect(warnings).toContain('PDF/X-3: 透明を平らにするため、1 か所 (1 ページ目) を画像 (300ppi 以上) にしました');
    expect(warnings.some((w) => /では透明 \(/.test(w))).toBe(false);
  });

  it('検査: PDF/X-3 は機器によらない色 (ICCBased・Lab・CalRGB・CalGray) を使える (PDF/X-1a では使えない)。DeviceRGB はどちらも使えない', async () => {
    const { verifyPdfX1a, verifyPdfX3 } = await import('../src/pdfxVerify');
    const bytes = await (await typesetHtml(`${page}<p>本文</p>`, { loadFont })).toPdf({ pdfx: { version: 'X-3' } });
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const icc = pdf.context.register(pdf.context.stream(CMYK_PROFILE, { N: 4 }));
    const res = pdf.getPage(0).node.Resources()!;
    res.set(PDFName.of('ColorSpace'), pdf.context.obj({ CS0: [PDFName.of('ICCBased'), icc], CS1: [PDFName.of('Lab'), { WhitePoint: [0.9505, 1, 1.089] }], CS2: PDFName.of('DeviceRGB'), CS3: [PDFName.of('CalRGB'), { WhitePoint: [0.9505, 1, 1.089] }], CS4: [PDFName.of('CalGray'), { WhitePoint: [0.9505, 1, 1.089] }] }));
    const edited = await pdf.save({ useObjectStreams: false });
    const spaces = (problems: string[]) => problems.filter((p) => /使えない色空間/.test(p)).map((p) => /色空間 (\w+)/.exec(p)![1]).sort();
    expect(spaces(await verifyPdfX3(edited))).toEqual(['DeviceRGB']);
    expect(spaces(await verifyPdfX1a(edited, 'X-1a:2003'))).toEqual(['CalGray', 'CalRGB', 'DeviceRGB', 'ICCBased', 'Lab']);
  });
});

describe('透明を平らにする計算 (pdfFlatten.ts)', () => {
  it('Normal の合成の式 (ISO 32000-2 §11.3.3): CMYK は成分ごとの補間、特色は白か同じ特色の上だけ', async () => {
    const { blendNormal } = await import('../src/pdfFlatten');
    expect(blendNormal({ cmyk: [1, 0.5, 0, 0.2] }, 0.25, 'white')).toEqual({ cmyk: [0.25, 0.125, 0, 0.05] });
    expect(blendNormal({ cmyk: [1, 0, 0, 0] }, 0.5, { cmyk: [0, 1, 0, 0.4] })).toEqual({ cmyk: [0.5, 0.5, 0, 0.2] });
    const spot = { name: 'DIC 123', tint: 1, cmyk: [0, 0.6, 1, 0] as [number, number, number, number] };
    expect(blendNormal({ spot, tint: 0.8 }, 0.5, 'white')).toEqual({ spot, tint: 0.4 });
    expect(blendNormal({ spot, tint: 1 }, 0.5, { spot, tint: 0.2 })).toEqual({ spot, tint: 0.6 });
    expect(blendNormal({ spot, tint: 1 }, 0.5, { cmyk: [0, 0, 0, 0.1] })).toBeUndefined();
    expect(blendNormal({ cmyk: [0, 0, 0, 1] }, 0.5, { spot, tint: 0.2 })).toBeUndefined();
  });

  it('CSS の色を、PDF に書くのと同じ CMYK にする (灰色は K だけ)。平らにした色の CSS', async () => {
    const { flatColorOf, flatCss } = await import('../src/pdfFlatten');
    const { rgbToCmyk } = await import('../src/pdfRenderer');
    const { spotColor } = await import('../src/color');
    expect(flatColorOf('#808080', rgbToCmyk)).toEqual({ cmyk: [0, 0, 0, 1 - 128 / 255] });
    expect(flatColorOf('rgba(255, 0, 0, 0.5)', rgbToCmyk)).toEqual({ cmyk: [0, 1, 1, 0] });
    expect(flatColorOf('cmyk(10%, 20%, 30%, 40%)', rgbToCmyk)).toEqual({ cmyk: [0.1, 0.2, 0.3, 0.4] });
    const sp = flatColorOf(spotColor('金', 0.5, [0, 0.2, 0.8, 0.1]), rgbToCmyk);
    expect(sp).toMatchObject({ tint: 0.5, spot: { name: '金', cmyk: [0, 0.2, 0.8, 0.1] } });
    expect(flatCss({ cmyk: [0.25, 0, 1, 0.5] })).toBe('cmyk(0.25,0,1,0.5)');
    expect(flatCss(sp)).toBe(spotColor('金', 0.5, [0, 0.2, 0.8, 0.1]));
  });

  it('CMYK の画像にする: 版ごとの補数で描き、白の上に重ねる。分けられない描画モードの K は、下 (hue など) か上 (luminosity) の K', async () => {
    const { rasterCmyk } = await import('../src/pdfFlatten');
    const rect = (fill: string, extra: object = {}) => ({ segs: [{ op: 'M' as const, x: 0, y: 0 }, { op: 'L' as const, x: 72, y: 0 }, { op: 'L' as const, x: 72, y: 72 }, { op: 'L' as const, x: 0, y: 72 }, { op: 'Z' as const }], fill, evenOdd: false, strokeWidth: 0, lineCap: 0 as const, lineJoin: 0 as const, fillOpacity: 1, strokeOpacity: 1, ...extra });
    const cmykOf = (css: string): [number, number, number, number] => (css === 'A' ? [0.2, 0.4, 0, 0.6] : css === 'B' ? [0.8, 0, 0.5, 0.1] : [0, 0, 0, 0]);
    const pixel = (): [number, number, number, number] => [0, 0, 0, 0];
    const box = { x0: 0, y0: 0, x1: 72, y1: 72 };
    const at = (shapes: object[]) => [...rasterCmyk(shapes as never, box, 10, cmykOf, pixel).data.slice(0, 4)].map((v) => v / 255);
    const close = (got: number[], exp: number[]) => got.forEach((v, i) => expect(Math.abs(v - exp[i])).toBeLessThan(1.5 / 255));
    // 白の上の 50%
    close(at([rect('A', { fillOpacity: 0.5 })]), [0.1, 0.2, 0, 0.3]);
    // A の上の B 40% (Normal)
    close(at([rect('A'), rect('B', { fillOpacity: 0.4 })]), [0.2 * 0.6 + 0.8 * 0.4, 0.4 * 0.6, 0.5 * 0.4, 0.6 * 0.6 + 0.1 * 0.4]);
    // multiply: 補数の値の積 (1 − C の積) を補数に戻す
    close(at([rect('A'), rect('B', { blend: 'multiply' })]), [1 - 0.8 * 0.2, 0.4, 0.5, 1 - 0.4 * 0.9]);
    // 分けられない描画モードの K: hue は下の K、luminosity は上の K
    expect(Math.abs(at([rect('A'), rect('B', { blend: 'hue' })])[3] - 0.6)).toBeLessThan(1.5 / 255);
    expect(Math.abs(at([rect('A'), rect('B', { blend: 'luminosity' })])[3] - 0.1)).toBeLessThan(1.5 / 255);
  });

  it('凸の形の輪郭が必ず覆う多角形 (回した矩形・角丸)。凸でない形・輪郭の 2 つある形は使わない', async () => {
    const { coveredPolygon, polygonContains } = await import('../src/pdfFlatten');
    const M = (x: number, y: number) => ({ op: 'M' as const, x, y });
    const L = (x: number, y: number) => ({ op: 'L' as const, x, y });
    const Z = { op: 'Z' as const };
    // 45° 回した正方形 (中心 (10, 10)、中心から角まで 10)
    const diamond = coveredPolygon([M(10, 0), L(20, 10), L(10, 20), L(0, 10), Z])!;
    expect(diamond).toHaveLength(8);
    expect(polygonContains(diamond, { x0: 7, y0: 7, x1: 13, y1: 13 })).toBe(true);
    expect(polygonContains(diamond, { x0: 1, y0: 1, x1: 5, y1: 5 })).toBe(false);
    // 角丸の矩形 (角の半径 4): 角を落とした八角形
    const k = 4 * 0.5523;
    const C = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => ({ op: 'C' as const, x1, y1, x2, y2, x, y });
    const round = coveredPolygon([M(4, 0), L(36, 0), C(36 + k, 0, 40, 4 - k, 40, 4), L(40, 16), C(40, 16 + k, 36 + k, 20, 36, 20), L(4, 20), C(4 - k, 20, 0, 16 + k, 0, 16), L(0, 4), C(0, 4 - k, 4 - k, 0, 4, 0), Z])!;
    expect(polygonContains(round, { x0: 1, y0: 5, x1: 39, y1: 15 })).toBe(true);
    expect(polygonContains(round, { x0: 0, y0: 0, x1: 2, y1: 2 })).toBe(false);
    // 凹んだ形 (L 字)・輪郭の 2 つある形 (穴)・8 の字
    expect(coveredPolygon([M(0, 0), L(10, 0), L(10, 5), L(5, 5), L(5, 10), L(0, 10), Z])).toBeUndefined();
    expect(coveredPolygon([M(0, 0), L(10, 0), L(10, 10), L(0, 10), Z, M(2, 2), L(8, 2), L(8, 8), Z])).toBeUndefined();
    expect(coveredPolygon([M(0, 0), L(10, 10), L(10, 0), L(0, 10), Z])).toBeUndefined();
  });

  it('外接矩形が重なっても、実際には重ならない図形を見分ける', async () => {
    const { shapesOverlap } = await import('../src/pdfFlatten');
    const tri = (pts: number[][]) => ({ segs: [{ op: 'M' as const, x: pts[0][0], y: pts[0][1] }, ...pts.slice(1).map(([x, y]) => ({ op: 'L' as const, x, y })), { op: 'Z' as const }], fill: '#000', evenOdd: false, strokeWidth: 0, lineCap: 0 as const, lineJoin: 0 as const, fillOpacity: 1, strokeOpacity: 1 });
    // 正方形を対角線で分けた 2 つの三角形 (少し離す)
    const a = tri([[0, 0], [10, 0], [0, 10]]);
    const b = tri([[10, 1], [10, 10], [1, 10]]);
    expect(shapesOverlap([a], [b])).toBe(false);
    expect(shapesOverlap([a], [tri([[2, 2], [10, 2], [2, 10]])])).toBe(true);
  });
});
