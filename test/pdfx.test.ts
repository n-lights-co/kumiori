/**
 * 入稿用の PDF/X-4 の出力 (BACKLOG O-06): 版の印 (Info と XMP)・出力の ICC プロファイルの検査・PDF 1.6・透明・ボックス・
 * 塗り足しまでの範囲 (ページの中) の注釈とフォーム、コマンドの --pdfx・--output-profile。
 * X-3 の印そのもの (OutputIntent など) は pdfinfo.test.ts・api.test.ts で確かめる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { DOMParser } from '@xmldom/xmldom';
import { parseArgs } from '../src/cli';
import { markPdfStandard, pdfStandardOf } from '../src/pdfStandard';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

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

  it('塗り足しまでの範囲 (BleedBox) に掛かる注釈・リンクは書かずに警告する。X-3 では透明を警告し、題が無ければ Untitled', async () => {
    const r = await typesetHtml(html, { loadFont });
    for (const version of ['X-3', 'X-4'] as const) {
      const warnings: string[] = [];
      const pdf = await PDFDocument.load(await r.toPdf({ pdfx: { version, profile: CMYK_PROFILE, warnings } }), { updateMetadata: false });
      expect(annotCount(pdf)).toBe(0);
      expect(warnings).toContain('PDF/X では、ページの中 (塗り足しまでの範囲 BleedBox に掛かる所) の注釈・リンク・フォームの欄を書きません (リンク 1 件)');
      expect(warnings.some((w) => w.includes('PDF/X-3 では透明'))).toBe(version === 'X-3');
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
