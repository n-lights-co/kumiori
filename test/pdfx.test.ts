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
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import { DOMParser } from '@xmldom/xmldom';
import { parseArgs } from '../src/cli';
import { markPdfStandard, pdfStandardOf } from '../src/pdfStandard';
import { DEFAULT_FONTS, typesetFo, typesetHtml, type FontSpec } from '../src/index';
import { verifyPdfX1a, verifyPdfX3, verifyPdfX4 } from '../src/pdfxVerify';
import { ICC_CMYK_REGISTRY } from '../src/iccRegistry';
import { ensureFonts, fontDir } from './helpers';
import { encodeJpeg } from '../src/jpeg';
import { TEST_ICC_DESCRIPTION, testIccProfile } from './iccTestProfile';

/** 書体を手元の置き場から読む (ネットワークを使わない) */
const loadFont = async (spec: FontSpec) => {
  const f = path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/**
 * 試験の CMYK の出力機器のプロファイル (iccTestProfile.ts。頭・タグの表・desc・色の表まで ICC.1:2010 の形どおり) の、
 * 色空間 (space)・機器の種類 (cls) を変えたもの。noA2B1 なら AtoB1 の表 (A2B1。PDF/X-1a の出力意図のプロファイルに要る。ISO 15930-1 §6.3.2) を除く
 */
function iccProfile(space: string, cls = 'prtr', noA2B1 = false): Uint8Array {
  return testIccProfile({ colorSpace: space, deviceClass: cls, omit: noA2B1 ? ['A2B1'] : [] });
}
const CMYK_PROFILE = iccProfile('CMYK');

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
    // 包みの中に、後で書き換えられるように空白を約 2000 バイト入れる (XMP Specification Part 1 §7.3.2 の NOTE 3)
    const padding = /<\/x:xmpmeta>([\s]*)<\?xpacket end="w"\?>$/.exec(xmp)?.[1] ?? '';
    expect(padding.replace(/\n/g, '').length).toBeGreaterThanOrEqual(1900);
    expect(padding.split('\n').every((line) => line.length <= 100)).toBe(true);
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
    // 透明は警告しない。プロファイルの表 (B2A1) で RGB を CMYK にするので、式で変換する警告は出ない
    expect(warnings.some((w) => w.includes('透明'))).toBe(false);
    expect(warnings.some((w) => w.includes('ICC'))).toBe(false);
  });

  it('出力の ICC プロファイルが無いか CMYK でなければ、誤りとして投げる', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont });
    await expect(r.toPdf({ pdfx: { version: 'X-4' } })).rejects.toThrow(/ICC プロファイル/);
    await expect(r.toPdf({ pdfx: { version: 'X-4', profile: iccProfile('RGB ') } })).rejects.toThrow(/CMYK/);
    // 誤りの文は、組んだときの言語 (lang) で書く
    const en = await typesetHtml('<p>本文</p>', { loadFont, lang: 'en' });
    await expect(en.toPdf({ pdfx: { version: 'X-4' } })).rejects.toThrow(/requires an output ICC profile/);
    await expect(en.toPdf({ pdfx: { version: 'X-4', profile: iccProfile('RGB ') } })).rejects.toThrow(/must be a CMYK profile.*RGB/);
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
    await expect(r.toPdf({ pdfx: { version: 'X-1a', profile: iccProfile('RGB ') } })).rejects.toThrow(/PDF\/X-1a の出力の ICC プロファイルは、CMYK/);
    await expect(r.toPdf({ pdfx: { version: 'X-1a', profile: CMYK_PROFILE } })).resolves.toBeInstanceOf(Uint8Array);
    // AtoB1 の表 (A2B1) の無いプロファイルは使えない (ISO 15930-1 §6.3.2)
    await expect(r.toPdf({ pdfx: { version: 'X-1a', profile: iccProfile('CMYK', 'prtr', true) } })).rejects.toThrow(/AtoB1 の表 \(タグ A2B1\)/);
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
    markPdfStandard(pdf, pdfStandardOf({ version: 'X-4' })!, { version: 'X-4', profile: CMYK_PROFILE }, undefined, false, new Date(0));
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

  describe('放射グラデーションを画像にする: 1 色でなく、中心から端へ色が変わる (SVG 2 §14.2.3.2。ふつうの PDF の網かけと同じ形)', () => {
    /** 平らにした CMYK の画像 (1 つ) の、幅・高さの割合 (fx, fy) の画素 (0〜255 の C・M・Y・K) */
    const flatRaster = async (html: string) => {
      const { verifyPdfX1a } = await import('../src/pdfxVerify');
      const bytes = await (await typesetHtml(html, { loadFont })).toPdf({ pdfx: { version: 'X-1a', warnings: [] } });
      expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
      const images = pageImages(await PDFDocument.load(bytes, { updateMetadata: false })).filter((im) => String(im.dict.get(PDFName.of('ColorSpace'))) === '/DeviceCMYK');
      expect(images).toHaveLength(1);
      const im = images[0];
      return (fx: number, fy: number) => {
        const i = (Math.floor(im.height * fy) * im.width + Math.floor(im.width * fx)) * 4;
        return [...im.data.slice(i, i + 4)];
      };
    };
    /** 黄 (C・M が 0 で Y がある) と、青に寄った色 (C が Y より大きい) */
    const yellow = (c: number[]) => c[0] <= 4 && c[1] <= 4 && c[2] > 140;
    const bluish = (c: number[]) => c[0] > 90 && c[0] > c[2];

    it('SVG の radialGradient (半透明の止まり)', async () => {
      const at = await flatRaster(
        `${page}<svg width="200" height="100" viewBox="0 0 200 100"><defs><radialGradient id="r"><stop offset="0" stop-color="#ff0" stop-opacity="0.6"/><stop offset="1" stop-color="#00f" stop-opacity="0.6"/></radialGradient></defs><rect width="200" height="100" fill="url(#r)"/></svg>`,
      );
      expect(at(0.5, 0.5)).toSatisfy(yellow);
      // 左の端の近く (t ≒ 0.96)
      expect(at(0.02, 0.5)).toSatisfy(bluish);
    });
    it('CSS の radial-gradient() (半透明の止まり)', async () => {
      const at = await flatRaster(`${page}<div style="width: 200pt; height: 100pt; background: radial-gradient(rgba(255, 255, 0, 0.6), rgba(0, 0, 255, 0.6))"></div>`);
      expect(at(0.5, 0.5)).toSatisfy(yellow);
      expect(at(0.02, 0.5)).toSatisfy(bluish);
    });
    it('CSS の repeating-radial-gradient() (opacity の箱の中)', async () => {
      // 円の半径 40pt ごとに、黄から青を繰り返す: 中心は黄、中心から 38pt (幅の 19%) は青に近い
      const at = await flatRaster(`${page}<div style="opacity: 0.6; width: 200pt; height: 100pt; background: repeating-radial-gradient(circle, #ff0 0, #00f 40pt)"></div>`);
      expect(at(0.5, 0.5)).toSatisfy(yellow);
      expect(at(0.5 - 38 / 200, 0.5)).toSatisfy(bluish);
    });
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

  describe('SVG の isolation: isolate のグループ (不透明度 1)', () => {
    const svg = (body: string) =>
      `${page}<svg width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#0f0"/><g style="isolation: isolate"><rect width="100" height="100" fill="#f00"/>${body}</g></svg>`;
    const groups = (pdf: PDFDocument) =>
      [...pdf.context.enumerateIndirectObjects()].filter(([, o]) => {
        const g = (o instanceof PDFRawStream ? o.dict : o instanceof PDFDict ? o : undefined)?.lookup(PDFName.of('Group'));
        return g instanceof PDFDict && String(g.get(PDFName.of('S'))) === '/Transparency';
      }).length;

    it('描画モードの子が無ければ、透明のグループにせずに子をじかに描く (警告も、画像にすることも無い)', async () => {
      const { verifyPdfX3 } = await import('../src/pdfxVerify');
      const r = await typesetHtml(svg('<rect x="50" y="25" width="100" height="50" fill="#00f"/>'), { loadFont });
      const warnings: string[] = [];
      const bytes = await r.toPdf({ pdfx: { version: 'X-3', warnings } });
      expect(await verifyPdfX3(bytes)).toEqual([]);
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      expect(groups(pdf)).toBe(0);
      expect(pageImages(pdf)).toEqual([]);
      expect(warnings.filter((w) => /透明/.test(w))).toEqual([]);
      // PDF/X でなければ、透明のグループ (Group の I が true) のまま書く。その PDF は、PDF/X-3 の検査に落ちる
      const plain = await r.toPdf();
      expect(groups(await PDFDocument.load(plain, { updateMetadata: false }))).toBe(1);
      expect(await verifyPdfX3(plain)).toContain('透明のグループを使っています');
    });

    it('描画モード (multiply) の子があれば、グループを開かない: 子は、グループの下の物 (緑) とは混ざらない', async () => {
      const { verifyPdfX3 } = await import('../src/pdfxVerify');
      const warnings: string[] = [];
      const bytes = await (await typesetHtml(svg('<rect x="50" y="25" width="100" height="50" fill="#00f" style="mix-blend-mode: multiply"/>'), { loadFont })).toPdf({ pdfx: { version: 'X-3', warnings } });
      expect(await verifyPdfX3(bytes)).toEqual([]);
      const images = pageImages(await PDFDocument.load(bytes, { updateMetadata: false })).filter((im) => String(im.dict.get(PDFName.of('ColorSpace'))) === '/DeviceCMYK');
      expect(images).toHaveLength(1);
      const im = images[0];
      const at = (fx: number, fy: number) => {
        const i = (Math.floor(im.height * fy) * im.width + Math.floor(im.width * fx)) * 4;
        return [...im.data.slice(i, i + 4)];
      };
      // 赤の外の青 (x = 120)。孤立したグループの中では、青は透明の上に描かれるので青のまま (Y が無い)。
      // グループを開くと、下の緑 (Y がある) と掛け合わさって、黒に近くなっていた
      const blue = at(0.6, 0.5);
      expect(blue[2]).toBeLessThan(40);
      expect(blue[0]).toBeGreaterThan(150);
      // 赤と青の重なり (x = 70) は、掛け合わさって黒に近い (Y もある)
      expect(at(0.35, 0.5)[2]).toBeGreaterThan(150);
    });
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

/** 出力意図 (GTS_PDFX) の辞書 */
const pdfxIntentOf = (pdf: PDFDocument) =>
  (pdf.catalog.lookup(PDFName.of('OutputIntents')) as PDFArray)
    .asArray()
    .map((r) => pdf.context.lookup(r) as PDFDict)
    .find((d) => String(d.get(PDFName.of('S'))) === '/GTS_PDFX')!;

describe('PDF/X の出力を規格 (ISO 15930-1・ISO 15930-7) に合わせる', () => {
  it('RegistryName は、印刷条件が ICC の登録簿に載っているときだけ書く', async () => {
    expect(['JC200103', 'JCS2011', 'JC200104', 'JCW2003', 'JCN2002', 'FOGRA39'].every((n) => ICC_CMYK_REGISTRY.has(n))).toBe(true);
    const r = await typesetHtml('<title>題</title><p>本文</p>', { loadFont });
    const reg = await PDFDocument.load(await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE, condition: 'JC200103' } }), { updateMetadata: false });
    expect(String(pdfxIntentOf(reg).get(PDFName.of('RegistryName')))).toBe('(http://www.color.org)');
    // 登録簿に無い名前 (大文字と小文字の違いも、一致しない)
    for (const condition of ['My Press 2026', 'jc200103']) {
      const bytes = await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE, condition } });
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      expect(pdfxIntentOf(pdf).get(PDFName.of('RegistryName'))).toBeUndefined();
      expect(await verifyPdfX4(bytes)).toEqual([]);
    }
    // PDF/A だけ (sRGB の出力意図) も、登録簿の名前でないので RegistryName を書かない
    const a = await PDFDocument.load(await r.toPdf({ pdfa: { version: 'A-2b' } }), { updateMetadata: false });
    const aIntent = (a.catalog.lookup(PDFName.of('OutputIntents')) as PDFArray).lookup(0) as PDFDict;
    expect(aIntent.get(PDFName.of('RegistryName'))).toBeUndefined();
  });

  it('X-1a: 印刷条件が登録簿に無ければ、出力の ICC プロファイルが要る (ISO 15930-1 §6.3.2)', async () => {
    const r = await typesetHtml('<title>題</title><p>本文</p>', { loadFont });
    await expect(r.toPdf({ pdfx: { version: 'X-1a', condition: 'My Press 2026' } })).rejects.toMatchObject({ code: 'pdfx/profile-required' });
    const bytes = await r.toPdf({ pdfx: { version: 'X-1a', condition: 'My Press 2026', profile: CMYK_PROFILE } });
    const intent = pdfxIntentOf(await PDFDocument.load(bytes, { updateMetadata: false }));
    expect(intent.get(PDFName.of('RegistryName'))).toBeUndefined();
    expect(intent.get(PDFName.of('DestOutputProfile'))).toBeDefined();
    expect(String(intent.get(PDFName.of('OutputCondition')))).toContain('My Press 2026');
    expect(await verifyPdfX1a(bytes, 'X-1a:2001')).toEqual([]);
    // 登録簿の名前なら、プロファイルは要らない
    await expect(r.toPdf({ pdfx: { version: 'X-1a', condition: 'JCS2011' } })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('X-4: 出力の ICC プロファイルは、出力機器のもの (機器の種類 prtr) に限る (ISO 15930-7 §6.4.2.1)', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont });
    await expect(r.toPdf({ pdfx: { version: 'X-4', profile: iccProfile('CMYK', 'mntr') } })).rejects.toMatchObject({ code: 'pdfx/profile-invalid', message: expect.stringMatching(/prtr.*mntr/) });
    const en = await typesetHtml('<p>本文</p>', { loadFont, lang: 'en' });
    await expect(en.toPdf({ pdfx: { version: 'X-4', profile: iccProfile('CMYK', 'scnr') } })).rejects.toThrow(/output device profile \(device class prtr\).*scnr/);
  });

  const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format"';
  const bookmarkFo = `<fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm"><fo:region-body margin="10mm"/></fo:simple-page-master></fo:layout-master-set>
  <fo:bookmark-tree><fo:bookmark internal-destination="a"><fo:bookmark-title>中</fo:bookmark-title></fo:bookmark><fo:bookmark external-destination="url('https://example.com/')"><fo:bookmark-title>外</fo:bookmark-title></fo:bookmark></fo:bookmark-tree>
  <fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body"><fo:block id="a">本文</fo:block></fo:flow></fo:page-sequence></fo:root>`;
  /** しおりの辞書 (題の順) */
  const outlineItems = (pdf: PDFDocument) => {
    const out: PDFDict[] = [];
    let ref = (pdf.catalog.lookup(PDFName.of('Outlines')) as PDFDict).get(PDFName.of('First'));
    while (ref) {
      const d = pdf.context.lookup(ref) as PDFDict;
      out.push(d);
      ref = d.get(PDFName.of('Next'));
    }
    return out;
  };

  it('しおりの外への飛び先 (動作) を書かず、題と文書の中の飛び先 (Dest) だけを残して警告する (ISO 15930-1 §6.20・ISO 15930-7 §6.18)', async () => {
    const f = await typesetFo(bookmarkFo, { loadFont });
    for (const version of ['X-1a', 'X-3', 'X-4'] as const) {
      const warnings: string[] = [];
      const bytes = await f.toPdf({ pdfx: { version, profile: CMYK_PROFILE, warnings } });
      const items = outlineItems(await PDFDocument.load(bytes, { updateMetadata: false }));
      expect(items.map((d) => (d.get(PDFName.of('Title')) as PDFHexString).decodeText())).toEqual(['中', '外']);
      expect(items[0].get(PDFName.of('Dest'))).toBeDefined();
      expect(items.every((d) => !d.get(PDFName.of('A')))).toBe(true);
      const label = version === 'X-1a' ? 'PDF/X-1a' : `PDF/${version}`;
      expect(warnings).toContain(`${label} では動作 (Action) を書けないので、書きません (しおりの外への飛び先 1 件)。しおりは題と文書の中の飛び先だけを残します`);
    }
    // PDF/X でなければ、これまでどおり URI の動作を書く
    const plain = outlineItems(await PDFDocument.load(await f.toPdf(), { updateMetadata: false }));
    expect(String((plain[1].lookup(PDFName.of('A')) as PDFDict).get(PDFName.of('S')))).toBe('/URI');
  });

  it('塗り足しまでの範囲の外のリンクも、動作 (URI) を持つなら書かない', async () => {
    // 塗り足し 0 でトンボを付けた用紙の、仕上がりの外 (左の余白) に置いた外へのリンク
    const html = '<style>@page { size: A6; marks: crop; bleed: 0 } .o { position: absolute; left: -28mm; top: 10mm }</style><p>本文</p><p class="o"><a href="https://example.com/">外</a></p>';
    const r = await typesetHtml(html, { loadFont, style: 'ah' });
    // PDF/X でなければ、リンクは BleedBox の外にある
    const plain = await PDFDocument.load(await r.toPdf(), { updateMetadata: false });
    const rect = (plain.context.lookup((plain.getPage(0).node.lookup(PDFName.of('Annots')) as PDFArray).get(0)) as PDFDict).lookup(PDFName.of('Rect')) as PDFArray;
    expect(Number(String(rect.get(2)))).toBeLessThan(plain.getPage(0).getBleedBox().x);
    const warnings: string[] = [];
    const pdf = await PDFDocument.load(await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE, warnings } }), { updateMetadata: false });
    expect(annotCount(pdf)).toBe(0);
    expect(warnings).toContain('PDF/X-4 では動作 (Action) を書けないので、書きません (動作を持つ注釈 1 件)。しおりは題と文書の中の飛び先だけを残します');
    const en = await typesetHtml(html, { loadFont, style: 'ah', lang: 'en' });
    const enWarnings: string[] = [];
    await en.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE, warnings: enWarnings } });
    expect(enWarnings).toContain('PDF/X-4 does not allow actions, so these are not written (1 annotation(s) with actions); bookmarks keep only their titles and destinations within the document');
  });

  it('X-4 では、字形の無い字 (.notdef) を描かずに警告する (ISO 15930-7 §6.5.2)。X-1a・X-3 は、これまでどおり', async () => {
    const r = await typesetHtml('<p>あ་い</p>', { loadFont });
    const warnings: string[] = [];
    const bytes = await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE, warnings } });
    expect(warnings.some((w) => /^PDF\/X-4 では字形の無い字 \(\.notdef\) を描けない/.test(w))).toBe(true);
    // 字の命令の符号に CID 0 を書かない (ToUnicode の CMap の <0000> は除いて見る)
    const glyphs = (pdf: PDFDocument) => contentOf(pdf).split(/begincmap[\s\S]*?endcmap/).join(' ');
    expect(glyphs(await PDFDocument.load(bytes, { updateMetadata: false }))).not.toMatch(/<(?:[0-9A-F]{4})*0000/i);
    const x3 = await PDFDocument.load(await r.toPdf({ pdfx: { version: 'X-3' } }), { updateMetadata: false });
    expect(glyphs(x3)).toMatch(/<(?:[0-9A-F]{4})*0000/i);
  });

  describe('色・画像・グラデーション・SVG・縦書き・特色・トンボ・透明・しおり・リンクを入れた文書が、書き出した後の検査に通る', () => {
    const jpg = encodeJpeg({ width: 8, height: 8, components: 3, data: new Uint8Array(8 * 8 * 3).map((_, i) => (i * 37) % 256) });
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f" stop-opacity="0.5"/></linearGradient></defs>' +
      '<rect width="120" height="60" fill="url(#g)"/><circle cx="30" cy="30" r="20" fill="#0a0" opacity="0.6"/><text x="60" y="35" font-size="12" fill="#333">図の字</text></svg>';
    const html =
      '<title>見本の文書</title><style>@page { size: A5; marks: crop cross; bleed: 3mm } .v { writing-mode: vertical-rl; height: 30mm } .spot { color: rgb-icc(255, 0, 128, #Separation, \'Ink A\') }</style>' +
      '<h1 style="color: #c03020">見出し</h1><h2>小見出し</h2>' +
      '<p style="background: linear-gradient(90deg, #f00, #00f); color: device-cmyk(0 0 0 1)">グラデーションの上の字</p>' +
      '<p style="background: radial-gradient(#ff0, rgba(0, 128, 255, 0.4)); opacity: 0.7">半透明の段落</p>' +
      '<p class="spot">特色の字</p><div class="v">縦書きの「段落」です。</div>' +
      '<p><img src="p.jpg" style="width: 20mm"> <img src="f.svg" style="width: 30mm"></p>' +
      `<p><a href="https://example.com/">外へのリンク</a>・<a href="#t">中へのリンク</a></p><h2 id="t">飛び先</h2>`;
    const make = (lang?: 'en') => typesetHtml(html, { loadFont, style: 'ah', spotColors: { 'Ink A': [0, 0.6, 0.2, 0] }, files: [{ name: 'p.jpg', data: jpg }, { name: 'f.svg', data: new TextEncoder().encode(svg) }], ...(lang ? { lang } : {}) });

    it('X-4 (PDF/A-2b・PDF/UA-1 と合わせても)', async () => {
      const r = await make();
      for (const extra of [{}, { pdfa: { version: 'A-2b' as const } }, { pdfua: {} }, { pdfa: { version: 'A-3b' as const }, pdfua: {} }]) {
        const warnings: string[] = [];
        const bytes = await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE, warnings }, ...extra });
        expect(await verifyPdfX4(bytes)).toEqual([]);
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
        // しおり (見出し) は残り、ページの中のリンクは書かない
        expect(pdf.catalog.get(PDFName.of('Outlines'))).toBeDefined();
        expect(annotCount(pdf)).toBe(0);
        expect(warnings.some((w) => /透明/.test(w))).toBe(false);
      }
    }, 120_000);

    it('X-1a:2001・X-1a:2003・X-3 (透明を平らにする)', async () => {
      const r = await make();
      for (const [version, check] of [
        ['X-1a', (b: Uint8Array) => verifyPdfX1a(b, 'X-1a:2001')],
        ['X-1a:2003', (b: Uint8Array) => verifyPdfX1a(b, 'X-1a:2003')],
        ['X-3', verifyPdfX3],
      ] as const) {
        const bytes = await r.toPdf({ pdfx: { version, profile: CMYK_PROFILE } });
        expect(await check(bytes)).toEqual([]);
      }
    }, 120_000);
  });
});

describe('PDF/X の検査が、わざと入れた違反を見つける', () => {
  /** 書き出した PDF/X を読み、change で書き換えて、版の頭をそのままにして書き出す */
  const tamper = async (bytes: Uint8Array, change: (pdf: PDFDocument) => void) => {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    change(pdf);
    const out = await pdf.save({ useObjectStreams: false });
    out.set(bytes.subarray(0, 8), 0);
    return out;
  };
  /** 1 ページ目に、資源 (Resources) の名前 key の辞書を足す */
  const addResource = (pdf: PDFDocument, kind: string, name: string, value: unknown) => {
    const page = pdf.getPage(0).node;
    const res = page.lookup(PDFName.of('Resources'), PDFDict);
    let d = res.lookup(PDFName.of(kind));
    if (!(d instanceof PDFDict)) res.set(PDFName.of(kind), (d = pdf.context.obj({})));
    (d as PDFDict).set(PDFName.of(name), pdf.context.obj(value as never));
  };
  let x4: Uint8Array;
  let x1a: Uint8Array;
  beforeAll(async () => {
    const r = await typesetHtml('<title>題</title><p>本文</p>', { loadFont });
    x4 = await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE, condition: 'JC200103' } });
    x1a = await r.toPdf({ pdfx: { version: 'X-1a', profile: CMYK_PROFILE, condition: 'JC200103' } });
    expect(await verifyPdfX4(x4)).toEqual([]);
    expect(await verifyPdfX1a(x1a, 'X-1a:2001')).toEqual([]);
  });

  const cases: Array<[string, 'x4' | 'x1a' | 'both', (pdf: PDFDocument) => void, RegExp]> = [
    ['動作 (しおりの URI)', 'both', (pdf) => {
      const ctx = pdf.context;
      const item = ctx.register(ctx.obj({ Title: PDFString.of('a'), A: { S: 'URI', URI: PDFString.of('https://example.com/') } }));
      const root = ctx.register(ctx.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
      (ctx.lookup(item) as PDFDict).set(PDFName.of('Parent'), root);
      pdf.catalog.set(PDFName.of('Outlines'), root);
    }, /動作 \(URI\)/],
    ['文書を開いたときの動作', 'both', (pdf) => pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') })), /OpenAction/],
    ['名前の辞書の JavaScript', 'both', (pdf) => pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ JavaScript: { Names: [] } })), /JavaScript があります/],
    ['追加の動作 (AA)', 'both', (pdf) => pdf.getPage(0).node.set(PDFName.of('AA'), pdf.context.obj({ O: { S: 'URI', URI: PDFString.of('x') } })), /追加の動作 \(AA\)/],
    ['描画の状態の TR', 'both', (pdf) => addResource(pdf, 'ExtGState', 'GT', { Type: 'ExtGState', TR: 'Identity' }), /転送の関数 \(TR\)/],
    ['描画の状態の HTP', 'both', (pdf) => addResource(pdf, 'ExtGState', 'GH', { HTP: [1, 2] }), /HTP/],
    ['X-4 の TR2 (Default でない)', 'x4', (pdf) => addResource(pdf, 'ExtGState', 'G2', { TR2: 'Identity' }), /TR2\) が Default ではありません/],
    ['X-1a の TR2 (Default でも不可)', 'x1a', (pdf) => addResource(pdf, 'ExtGState', 'G2', { TR2: 'Default' }), /転送の関数 \(TR2\) があります/],
    ['網点の種類 6', 'both', (pdf) => addResource(pdf, 'ExtGState', 'GN', { HT: { Type: 'Halftone', HalftoneType: 6, Width: 1, Height: 1 } }), /HalftoneType 6/],
    ['網点の HalftoneName', 'both', (pdf) => addResource(pdf, 'ExtGState', 'GN', { HT: { Type: 'Halftone', HalftoneType: 1, Frequency: 100, Angle: 45, SpotFunction: 'Round', HalftoneName: PDFString.of('x') } }), /HalftoneName/],
    ['PostScript の XObject', 'both', (pdf) => addResource(pdf, 'XObject', 'P0', pdf.context.register(pdf.context.flateStream(new TextEncoder().encode('0 0 moveto'), { Type: 'XObject', Subtype: 'PS' }))), /PostScript の XObject/],
    ['PS の命令', 'both', (pdf) => pdf.getPage(0).node.addContentStream(pdf.context.register(pdf.context.flateStream(new TextEncoder().encode('(showpage) PS\n')))), /PostScript の命令 \(PS\)/],
    // 資源 (Resources) にじかに書いた Type3 の書体の字形 (CharProcs) も、内容の流れとして調べる
    ['Type3 の字形 (資源にじかに書いた書体) の RGB の色', 'x1a', (pdf) => addResource(pdf, 'Font', 'T3', { Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1, 1], FontMatrix: [1, 0, 0, 1, 0, 0], CharProcs: { a: pdf.context.register(pdf.context.flateStream(new TextEncoder().encode('1 0 0 rg 0 0 1 1 re f\n'))) }, Encoding: { Type: 'Encoding', Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1], Resources: {} }), /RGB の色 \(rg・RG\)/],
    // 注釈の見え方 (/AP の N・R・D) は、Subtype の無い流れでも、見え方の状態ごとの流れの辞書でも、内容の流れとして調べる
    ['注釈の見え方 (AP の N の状態の辞書) の PS の命令', 'both', (pdf) => {
      const ps = pdf.context.register(pdf.context.flateStream(new TextEncoder().encode('(showpage) PS\n'), { BBox: [0, 0, 1, 1] }));
      pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [-20, -20, -10, -10], AP: { N: { On: ps } } })]));
    }, /PostScript の命令 \(PS\)/],
    ['X-4 の LZWDecode', 'x4', (pdf) => addResource(pdf, 'XObject', 'L0', pdf.context.register(pdf.context.stream(new Uint8Array([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Filter: 'LZWDecode' }))), /LZWDecode/],
    ['X-1a の ASCIIHexDecode (画像でない流れ)', 'x1a', (pdf) => addResource(pdf, 'XObject', 'H0', pdf.context.register(pdf.context.stream(new TextEncoder().encode('20>'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Filter: 'ASCIIHexDecode' }))), /ASCIIHexDecode/],
    ['X-1a の CCITTFaxDecode (1 ビットでない画像)', 'x1a', (pdf) => addResource(pdf, 'XObject', 'C0', pdf.context.register(pdf.context.stream(new Uint8Array([0]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'CCITTFaxDecode' }))), /CCITTFaxDecode/],
    ['GTS_PDFX の出力意図が 2 つ', 'both', (pdf) => {
      const intents = pdf.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
      intents.push(pdf.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFX', OutputConditionIdentifier: PDFString.of('JC200103') }));
    }, /GTS_PDFX の出力意図が 2 個/],
    ['登録簿に無い印刷条件の RegistryName', 'both', (pdf) => pdfxIntentOf(pdf).set(PDFName.of('OutputConditionIdentifier'), PDFString.of('Japan Color 2001 Coated')), /登録簿の名前と一致しません/],
    ['X-1a: 登録簿に無い印刷条件でプロファイルが無い', 'x1a', (pdf) => {
      const intent = pdfxIntentOf(pdf);
      intent.set(PDFName.of('OutputConditionIdentifier'), PDFString.of('My Press'));
      intent.delete(PDFName.of('RegistryName'));
      intent.delete(PDFName.of('DestOutputProfile'));
    }, /DestOutputProfile がありません/],
    ['X-1a: プロファイルに AtoB1 の表が無い', 'x1a', (pdf) => pdfxIntentOf(pdf).set(PDFName.of('DestOutputProfile'), pdf.context.register(pdf.context.stream(iccProfile('CMYK', 'prtr', true), { N: 4 }))), /AtoB1/],
    ['X-4: DestOutputProfileRef', 'x4', (pdf) => pdfxIntentOf(pdf).set(PDFName.of('DestOutputProfileRef'), pdf.context.obj({ URLs: [] })), /DestOutputProfileRef/],
    ['X-4: プロファイルが出力機器のものでない', 'x4', (pdf) => {
      const p = iccProfile('CMYK', 'mntr');
      const ref = pdf.context.register(pdf.context.stream(p, { N: 4 }));
      pdfxIntentOf(pdf).set(PDFName.of('DestOutputProfile'), ref);
    }, /機器の種類 prtr/],
    ['X-4: DeviceRGB の色空間と rg の命令', 'x4', (pdf) => {
      addResource(pdf, 'ColorSpace', 'CS0', ['Separation', 'Ink', 'DeviceRGB', { FunctionType: 2, Domain: [0, 1], C0: [1, 1, 1], C1: [1, 0, 0], N: 1 }]);
      pdf.getPage(0).node.addContentStream(pdf.context.register(pdf.context.flateStream(new TextEncoder().encode('1 0 0 rg 0 0 1 1 re f\n'))));
    }, /DeviceRGB|rg・RG/],
    ['X-4: 出力意図と同じプロファイルの ICCBased', 'x4', (pdf) => addResource(pdf, 'ColorSpace', 'CS1', ['ICCBased', pdf.context.register(pdf.context.stream(CMYK_PROFILE, { N: 4 }))]), /出力意図と同じプロファイル/],
    ['X-4: 決まっていない描画モード', 'x4', (pdf) => addResource(pdf, 'ExtGState', 'GB', { BM: 'Dissolve' }), /描画モード \(\/Dissolve\)/],
    ['X-1a: 透明 (不透明度)', 'x1a', (pdf) => addResource(pdf, 'ExtGState', 'GA', { ca: 0.5 }), /透明 \(不透明度\)/],
    ['TrimBox が CropBox の外', 'both', (pdf) => pdf.getPage(0).setCropBox(50, 50, 100, 100), /TrimBox \(か ArtBox\) が BleedBox・CropBox からはみ出し/],
    ['X-4: BleedBox が CropBox の外', 'x4', (pdf) => {
      const t = pdf.getPage(0).getTrimBox();
      pdf.getPage(0).setCropBox(t.x, t.y, t.width, t.height);
      pdf.getPage(0).setBleedBox(t.x - 5, t.y - 5, t.width + 10, t.height + 10);
    }, /BleedBox が CropBox から/],
    ['X-1a: 塗り足しまでの範囲の PrinterMark', 'x1a', (pdf) => {
      const b = pdf.getPage(0).getTrimBox();
      pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.obj({ Type: 'Annot', Subtype: 'PrinterMark', Rect: [b.x, b.y, b.x + 5, b.y + 5] })]));
    }, /注釈 \(PrinterMark\)/],
    ['X-4: TrimBox に掛かる PrinterMark', 'x4', (pdf) => {
      const b = pdf.getPage(0).getTrimBox();
      pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.obj({ Type: 'Annot', Subtype: 'PrinterMark', Rect: [b.x - 2, b.y - 2, b.x + 5, b.y + 5] })]));
    }, /PrinterMark\) が TrimBox/],
    ['X-4: メタデータの流れの Filter', 'x4', (pdf) => {
      const meta = pdf.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream;
      const xmp = decodePDFRawStream(meta).decode();
      pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.flateStream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
    }, /Filter があります/],
  ];
  for (const [name, which, change, expected] of cases) {
    it(name, async () => {
      for (const kind of which === 'both' ? (['x4', 'x1a'] as const) : [which]) {
        const bytes = await tamper(kind === 'x4' ? x4 : x1a, change);
        const problems = kind === 'x4' ? await verifyPdfX4(bytes) : await verifyPdfX1a(bytes, 'X-1a:2001');
        expect(problems.join('\n'), `${kind}: ${problems.join(' / ')}`).toMatch(expected);
      }
    });
  }

  it('X-4 の XMP の違反を 1 つずつ見つける (§6.9・§6.10.3・§6.10.4・§6.11・§6.10.2)', async () => {
    const bytes = await tamper(x4, (pdf) => {
      const meta = pdf.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream;
      const xmp = new TextDecoder()
        .decode(decodePDFRawStream(meta).decode())
        .replace('id="W5M0MpCehiHzreSzNTczkc9d"', 'id="W5M0MpCehiHzreSzNTczkc9d" encoding="UTF-8"')
        .replace(/<xmp:MetadataDate>[^<]*<\/xmp:MetadataDate>/, '')
        .replace(/<xmpMM:RenditionClass>[^<]*<\/xmpMM:RenditionClass>/, '')
        .replace('<pdf:Trapped>False</pdf:Trapped>', '<pdf:Trapped>Unknown</pdf:Trapped><pdfxid:GTS_PDFXConformance>x</pdfxid:GTS_PDFXConformance>')
        .replace(/<xmp:CreateDate>[^<]*</, '<xmp:CreateDate>2001-01-01T00:00:00Z<')
        .replace(/<dc:title>[\s\S]*?<\/dc:title>/, '');
      pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })));
      (pdf.context.lookup(pdf.context.trailerInfo.Info) as PDFDict).set(PDFName.of('GTS_PDFXConformance'), PDFString.of('PDF/X-1a:2001'));
    });
    const problems = (await verifyPdfX4(bytes)).join('\n');
    for (const p of [/包みの頭 \(xpacket\) に bytes・encoding/, /xmp:MetadataDate がありません/, /xmpMM:RenditionClass がありません/, /dc:title/, /pdf:Trapped が True か False ではありません/, /GTS_PDFXVersion のほかの項目 \(GTS_PDFXConformance\)/, /Info に GTS_PDFXConformance があります/, /Info の CreationDate と XMP の日付が違います/, /Info の Title と XMP の値が違います/, /Info の Trapped と XMP の値が違います/])
      expect(problems).toMatch(p);
    // メタデータが無ければ
    const none = await tamper(x4, (pdf) => pdf.catalog.delete(PDFName.of('Metadata')));
    expect((await verifyPdfX4(none)).join('\n')).toMatch(/Metadata\) がありません/);
  });

  it('X-4 の PrinterMark は、TrimBox の外 (縁に接するのも外) なら塗り足しまでの範囲に掛かってよい。X-1a の TrapNet も', async () => {
    const withMark = (bytes: Uint8Array, subtype: string) =>
      tamper(bytes, (pdf) => {
        const b = pdf.getPage(0).getTrimBox();
        pdf.getPage(0).node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.obj({ Type: 'Annot', Subtype: subtype, Rect: [b.x - 5, b.y - 5, b.x, b.y] })]));
      });
    expect(await verifyPdfX4(await withMark(x4, 'PrinterMark'))).toEqual([]);
    expect(await verifyPdfX1a(await withMark(x1a, 'TrapNet'), 'X-1a:2001')).toEqual([]);
  });
});

describe('PDF/X の検査が、内容の流れだけを読む', () => {
  // 書体のファイル (Length1 の無い TrueType の流れ) の字形のデータの中の、命令と同じ字 (PS・rg) を命令と見なしていた。
  // 既定の書体の「戀」(明朝の太字) と「赥」(ゴシック) の字形に、偶然に現れる
  for (const [label, body] of [['戀 (明朝)', '<h1>戀</h1>'], ['赥 (ゴシック)', '<p style="font-family: sans-serif">赥</p>']] as const) {
    it(`${label} を組んだ PDF/X-1a・X-3・X-4 が、書き出した後の検査に通る`, async () => {
      const r = await typesetHtml(`<!doctype html><html lang="ja"><head><title>t</title></head><body>${body}</body></html>`, { loadFont });
      expect(await verifyPdfX1a(await r.toPdf({ pdfx: { version: 'X-1a' } }), 'X-1a:2001')).toEqual([]);
      expect(await verifyPdfX3(await r.toPdf({ pdfx: { version: 'X-3' } }))).toEqual([]);
      expect(await verifyPdfX4(await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE } }))).toEqual([]);
    });
  }

  it('構造の型が JavaScript の構造の節 (role="JavaScript") を、JavaScript の動作と見なさない (X-4)', async () => {
    const r = await typesetFo(
      '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja"><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block role="JavaScript">本文</fo:block></fo:flow></fo:page-sequence></fo:root>',
      { loadFont, tagged: true },
    );
    const bytes = await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE } });
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const roles = pdf.context.enumerateIndirectObjects().map(([, o]) => (o instanceof PDFDict && String(o.get(PDFName.of('Type'))) === '/StructElem' ? String(o.get(PDFName.of('S'))) : '')).filter(Boolean);
    expect(roles).toContain('/JavaScript');
    expect(await verifyPdfX4(bytes)).toEqual([]);
  });

  it('知らない版 (x4・PDF/X-5 など) は、PDF/X-3 にせず、選択肢の誤りにする (大文字小文字を区別する)', async () => {
    expect(pdfStandardOf({})?.label).toBe('PDF/X-3');
    expect(pdfStandardOf({ version: 'X-3' })?.label).toBe('PDF/X-3');
    for (const v of ['x4', 'X-5', '']) expect(() => pdfStandardOf({ version: v as never })).toThrow(expect.objectContaining({ name: 'KumioriOptionError', option: 'pdfx.version' }));
    const r = await typesetHtml('<p>本文</p>', { loadFont });
    await expect(r.toPdf({ pdfx: { version: 'x4' as never, profile: CMYK_PROFILE } })).rejects.toThrow(/PDF\/X の版 "x4" は使えません/);
  });
});

describe('区切りだけのキーワード', () => {
  it('キーワードが区切りだけ (",") でも、PDF/X-4・PDF/A-2b の Info と XMP の一致の検査に通る (空の Keywords を書かない)', async () => {
    const { verifyPdfA } = await import('../src/pdfaVerify');
    const r = await typesetFo(
      '<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions" xml:lang="ja"><axf:document-info name="document-title" value="t"/><axf:document-info name="keywords" value=","/><fo:layout-master-set><fo:simple-page-master master-name="p"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block>本文</fo:block></fo:flow></fo:page-sequence></fo:root>',
      { loadFont },
    );
    const x4 = await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE } });
    expect(await verifyPdfX4(x4)).toEqual([]);
    expect((await PDFDocument.load(x4, { updateMetadata: false })).getKeywords()).toBeUndefined();
    expect(await verifyPdfA(await r.toPdf({ pdfa: { version: 'A-2b' } }), 2)).toEqual([]);
  });
});

describe('出力の ICC プロファイルと、出力意図の印刷条件', () => {
  /** 頭とタグの表だけで、タグの中身の無いもの (前の試験の作り。ICC.1:2010 §7.3 の位置・大きさが 0) */
  const headerOnly = (() => {
    const head = new Array(144).fill(0);
    const put = (o: number, t: string) => [...t].forEach((c, k) => (head[o + k] = c.charCodeAt(0)));
    put(12, 'prtr');
    put(16, 'CMYK');
    put(20, 'Lab ');
    put(36, 'acsp');
    head[131] = 1;
    put(132, 'A2B1');
    return Uint8Array.from(head);
  })();
  /** プロファイルの写しの、ofs バイト目から 4 バイトを v (大きい方が先) にする */
  const patched = (p: Uint8Array, ofs: number, v: number) => {
    const q = p.slice();
    new DataView(q.buffer).setUint32(ofs, v);
    return q;
  };
  const good = testIccProfile();
  /** タグの表の k 番目の位置 (132 + 12k + 4) */
  const tagOffsetAt = (k: number) => 132 + 12 * k + 4;

  it('自作のプロファイルは、タグの表まで ICC.1:2010 の形どおりで、表で CMYK にできる', async () => {
    const { iccProfileProblem, iccDescription } = await import('../src/iccRegistry');
    const { iccRgbToCmyk } = await import('../src/icc');
    expect(iccProfileProblem(good)).toBeUndefined();
    expect(iccDescription(good)).toBe(TEST_ICC_DESCRIPTION);
    expect(iccDescription(testIccProfile({ version: 4, description: 'Kumiori v4 test' }))).toBe('Kumiori v4 test');
    const conv = iccRgbToCmyk(good)!;
    expect(conv).toBeDefined();
    // 白は何も刷らず、黒は K だけに近い (表は式をおおまかに表にしたもの)
    expect(conv(1, 1, 1).every((v) => v < 0.02)).toBe(true);
    const k = conv(0, 0, 0);
    expect(k[3]).toBeGreaterThan(0.95);
  });

  it('頭だけ・表の壊れたプロファイルは誤り (pdfx/profile-invalid。ICC.1:2010 §7.2・§7.3・§8.2)', async () => {
    const r = await typesetHtml('<title>題</title><p>本文</p>', { loadFont });
    const bad: Array<[string, Uint8Array, RegExp]> = [
      ['頭とタグの署名だけ (中身の無いタグ)', headerOnly, /大きさ|タグ/],
      ['頭の大きさの欄が、ファイルより大きい', patched(good, 0, good.length + 4), /大きさ/],
      ['acsp が無い', patched(good, 36, 0), /acsp/],
      ['タグの数が表に収まらない', patched(good, 128, 100000), /タグの表/],
      ['タグの中身がファイルの外', patched(good, tagOffsetAt(3), good.length - 4), /タグ A2B0/],
      ['説明 (desc) が無い', testIccProfile({ omit: ['desc'] }), /desc/],
    ];
    for (const [name, profile, re] of bad)
      for (const version of ['X-4', 'X-1a', 'X-3'] as const) {
        const e = await r.toPdf({ pdfx: { version, profile } }).then(() => undefined, (x: unknown) => x as { code?: string; message?: string });
        expect(e, `${name} (${version})`).toMatchObject({ code: 'pdfx/profile-invalid' });
        expect(e!.message, name).toMatch(re);
      }
    const en = await typesetHtml('<p>body</p>', { loadFont, lang: 'en' });
    await expect(en.toPdf({ pdfx: { version: 'X-4', profile: headerOnly } })).rejects.toThrow(/ICC profile/);
    for (const version of ['X-4', 'X-1a', 'X-3'] as const) await expect(r.toPdf({ pdfx: { version, profile: good } })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('X-3 でも、プロファイルを渡すなら CMYK のものに限る', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont });
    await expect(r.toPdf({ pdfx: { version: 'X-3', profile: testIccProfile({ colorSpace: 'RGB ' }) } })).rejects.toThrow(/CMYK/);
  });

  it('X-3: 印刷条件が登録簿に無ければ、出力の ICC プロファイルが要る (X-1a と同じ決まり)', async () => {
    const r = await typesetHtml('<title>題</title><p>本文</p>', { loadFont });
    await expect(r.toPdf({ pdfx: { version: 'X-3', condition: 'MyPress' } })).rejects.toMatchObject({ code: 'pdfx/profile-required', message: expect.stringMatching(/PDF\/X-3.*MyPress/) });
    await expect(r.toPdf()).resolves.toBeInstanceOf(Uint8Array);
    // 登録簿の名前なら、これまでどおり登録名だけで出せる
    await expect(r.toPdf({ pdfx: { version: 'X-3', condition: 'JCS2011' } })).resolves.toBeInstanceOf(Uint8Array);
    const bytes = await r.toPdf({ pdfx: { version: 'X-3', condition: 'MyPress', profile: good } });
    expect(await verifyPdfX3(bytes)).toEqual([]);
    // 書き出した後の検査も、登録簿に無い印刷条件の DestOutputProfile の無い出力意図を見つける
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    pdfxIntentOf(pdf).delete(PDFName.of('DestOutputProfile'));
    expect((await verifyPdfX3(await pdf.save({ useObjectStreams: false }))).some((p) => /DestOutputProfile がありません/.test(p))).toBe(true);
  });

  it('プロファイルだけを渡すと、印刷条件の名前はプロファイルの説明 (desc) にし、RegistryName は書かない', async () => {
    const r = await typesetHtml('<title>題</title><p>本文</p>', { loadFont });
    for (const [version, profile, desc] of [
      ['X-4', good, TEST_ICC_DESCRIPTION],
      ['X-1a', testIccProfile({ version: 4, description: 'Kumiori v4 test' }), 'Kumiori v4 test'],
      ['X-3', good, TEST_ICC_DESCRIPTION],
    ] as const) {
      const bytes = await r.toPdf({ pdfx: { version, profile } });
      const intent = pdfxIntentOf(await PDFDocument.load(bytes, { updateMetadata: false }));
      const text = (k: string) => (intent.lookup(PDFName.of(k)) as PDFString | PDFHexString).decodeText();
      expect(text('OutputConditionIdentifier'), version).toBe(desc);
      expect(text('OutputCondition')).toBe(desc);
      expect(text('Info')).toBe(desc);
      expect(intent.get(PDFName.of('RegistryName'))).toBeUndefined();
      expect(intent.get(PDFName.of('DestOutputProfile'))).toBeDefined();
    }
    // 名前を渡せば、これまでどおりその名前 (登録簿の名前なら RegistryName も書く)
    const named = pdfxIntentOf(await PDFDocument.load(await r.toPdf({ pdfx: { version: 'X-4', profile: good, condition: 'JC200103' } }), { updateMetadata: false }));
    expect(String(named.get(PDFName.of('OutputConditionIdentifier')))).toBe('(JC200103)');
    expect(String(named.get(PDFName.of('RegistryName')))).toBe('(http://www.color.org)');
    // プロファイルも名前も無ければ、これまでどおり JC200103 (X-1a・X-3)
    const plain = pdfxIntentOf(await PDFDocument.load(await r.toPdf({ pdfx: {} }), { updateMetadata: false }));
    expect(String(plain.get(PDFName.of('OutputConditionIdentifier')))).toBe('(JC200103)');
    expect(String(plain.get(PDFName.of('RegistryName')))).toBe('(http://www.color.org)');
  });
});
