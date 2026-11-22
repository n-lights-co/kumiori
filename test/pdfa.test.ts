/**
 * 長期保存用の PDF/A-2b・PDF/A-3b の出力: 出力意図 (sRGB のプロファイル)・XMP の pdfaid・Info と XMP の一致・注釈の印と外観・
 * ファイルを開く動作 (Launch)・フォームの欄・字形の無い字・CMYK の色を RGB に直すこと・添付ファイル (A-2b は埋め込まない、A-3b は AF)・
 * PDF/X と合わせたときの出力意図と XMP、書き出した PDF の検査 (pdfaVerify.ts)、コマンドの --pdfa。
 * テストでは PDF の中身を読んで確かめる (PDF/A の検査の道具 veraPDF は Java のプログラムで、テストからは呼ばない。開発の中で、veraPDF 1.28.2 の
 * PDF/A-2b・3b の検査に掛けて合格を確かめた)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, rgb, cmyk } from 'pdf-lib';
import { parseArgs } from '../src/cli';
import { DEFAULT_FONTS, typesetHtml } from '../src/index';
import { importXslFo } from '../src/xslfoImport';
import { renderPdf } from '../src/pdfRenderer';
import { AssetStore } from '../src/assets';
import { verifyPdfA } from '../src/pdfaVerify';
import { srgbProfile } from '../src/srgbIcc';
import { ensureFonts, loadCachedFont, makeEngine } from './helpers';

/**
 * ICC のプロファイルの頭とタグの表だけのもの (色空間 space・機器の種類 cls。タグは署名だけで、中身は無い。ICC.1:2010 §7.2・§7.3)。
 * 既定のタグ A2B1 (AtoB1 の表) は、PDF/X-1a の出力意図のプロファイルに要る (ISO 15930-1 §6.3.2)
 */
function iccHeader(space: string, cls = 'prtr', tags: string[] = ['A2B1']): Uint8Array {
  const head = new Array(132 + tags.length * 12).fill(0);
  const put = (o: number, t: string) => [...t].forEach((c, k) => (head[o + k] = c.charCodeAt(0)));
  head[8] = 2;
  put(12, cls);
  put(16, space);
  put(20, 'Lab ');
  put(36, 'acsp');
  head[131] = tags.length;
  tags.forEach((t, k) => put(132 + k * 12, t));
  return Uint8Array.from(head);
}
const CMYK_PROFILE = iccHeader('CMYK');

const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false });
const infoOf = (pdf: PDFDocument, key: string) => {
  const v = (pdf.context.lookup(pdf.context.trailerInfo.Info) as PDFDict).lookup(PDFName.of(key));
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : v === undefined ? undefined : String(v);
};
const xmpOf = (pdf: PDFDocument) => {
  const s = pdf.catalog.lookup(PDFName.of('Metadata'));
  return s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : '';
};
const intentsOf = (pdf: PDFDocument) => (pdf.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray)?.asArray() ?? []).map((r) => pdf.context.lookup(r) as PDFDict);
const annots = (pdf: PDFDocument, page = 0) => {
  const a = pdf.getPages()[page].node.lookup(PDFName.of('Annots'));
  return a instanceof PDFArray ? a.asArray().map((x) => pdf.context.lookup(x as PDFRef) as PDFDict) : [];
};
/** ページの内容の流れ (展開したもの) */
const contentOf = (pdf: PDFDocument, page = 0) => {
  const c = pdf.getPages()[page].node.lookup(PDFName.of('Contents'));
  const streams = c instanceof PDFArray ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
  return streams.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n');
};

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const fo = (body: string) =>
  `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="150mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
  E = await makeEngine();
}, 300_000);

/** XSL-FO を組んで PDF にする (renderPdf の設定 opts) */
const foPdf = async (body: string, opts: Parameters<typeof renderPdf>[2] = {}, spotColors?: Record<string, [number, number, number, number]>) => {
  const r = importXslFo(fo(body), parse, spotColors ? { spotColors } : {});
  return renderPdf(E.engine.layout(r.document), E.fonts, opts);
};

describe('sRGB の ICC プロファイル (srgbIcc.ts)', () => {
  it('ICC の版 2.1・表示機器 (mntr)・RGB → XYZ・頭の大きさの欄が全体の長さ。項目は 9 つで、原色の和が D50 の白', () => {
    const p = srgbProfile();
    const u32 = (o: number) => ((p[o] << 24) | (p[o + 1] << 16) | (p[o + 2] << 8) | p[o + 3]) >>> 0;
    const sig = (o: number) => String.fromCharCode(...p.subarray(o, o + 4));
    expect(u32(0)).toBe(p.length);
    expect([p[8], p[9]]).toEqual([2, 0x10]);
    expect([sig(12), sig(16), sig(20), sig(36)]).toEqual(['mntr', 'RGB ', 'XYZ ', 'acsp']);
    const count = u32(128);
    expect(count).toBe(9);
    const tags = new Map<string, [number, number]>();
    for (let k = 0; k < count; k++) tags.set(sig(132 + 12 * k), [u32(136 + 12 * k), u32(140 + 12 * k)]);
    expect([...tags.keys()].sort()).toEqual(['bTRC', 'bXYZ', 'cprt', 'desc', 'gTRC', 'gXYZ', 'rTRC', 'rXYZ', 'wtpt']);
    for (const [o, n] of tags.values()) expect(o + n).toBeLessThanOrEqual(p.length);
    const xyz = (tag: string) => [0, 1, 2].map((i) => (u32(tags.get(tag)![0] + 8 + 4 * i) | 0) / 65536);
    const sum = [0, 1, 2].map((i) => xyz('rXYZ')[i] + xyz('gXYZ')[i] + xyz('bXYZ')[i]);
    expect(sum[0]).toBeCloseTo(0.9642, 3);
    expect(sum[1]).toBeCloseTo(1, 3);
    expect(sum[2]).toBeCloseTo(0.8252, 3);
    // 階調曲線: 1024 点で、0 から 65535 へ増える
    const [trc] = tags.get('rTRC')!;
    expect(sig(trc)).toBe('curv');
    expect(u32(trc + 8)).toBe(1024);
    const v = (i: number) => (p[trc + 12 + 2 * i] << 8) | p[trc + 13 + 2 * i];
    expect([v(0), v(1023)]).toEqual([0, 65535]);
    expect(v(512)).toBeGreaterThan(v(511));
  });
});

describe('PDF/A-2b・3b の出力', () => {
  const html = '<title>題 &amp; "名"</title><h1 id="a">見出し</h1><p style="opacity: 0.5; background: #c03020">半透明 <a href="https://example.com/">外</a> <a href="#a">内</a></p>';

  it('PDF/A-2b: PDF 1.7、出力意図は sRGB (GTS_PDFA1)、XMP の pdfaid:part 2・conformance B、Info と XMP の一致、透明はそのまま、検査に通る', async () => {
    const r = await typesetHtml(html, { loadFont: loadCachedFont });
    const warnings: string[] = [];
    const bytes = await r.toPdf({ pdfa: { version: 'A-2b', warnings } });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.7');
    expect(warnings).toEqual([]);
    expect(await verifyPdfA(bytes, 2)).toEqual([]);
    const pdf = await load(bytes);
    const intents = intentsOf(pdf);
    expect(intents.map((d) => String(d.get(PDFName.of('S'))))).toEqual(['/GTS_PDFA1']);
    const prof = intents[0].lookup(PDFName.of('DestOutputProfile')) as PDFRawStream;
    expect(String(prof.dict.get(PDFName.of('N')))).toBe('3');
    expect(decodePDFRawStream(prof).decode()).toEqual(srgbProfile());
    expect((intents[0].lookup(PDFName.of('OutputConditionIdentifier')) as PDFString).decodeText()).toBe('sRGB IEC61966-2.1');
    const xmp = xmpOf(pdf);
    expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('<rdf:li xml:lang="x-default">題 &amp; &quot;名&quot;</rdf:li>');
    // PDF/X の印は書かない
    expect(xmp).not.toContain('pdfxid');
    expect(xmp).not.toContain('pdf:Trapped');
    expect(infoOf(pdf, 'Trapped')).toBeUndefined();
    expect(infoOf(pdf, 'GTS_PDFXVersion')).toBeUndefined();
    // Info と XMP の日付が同じ時刻
    const created = /<xmp:CreateDate>(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)Z</.exec(xmp)!;
    expect(infoOf(pdf, 'CreationDate')).toContain(`D:${created.slice(1).join('')}Z`);
    // 透明はそのまま (PDF/A-2 は透明を使える)
    const gs = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict);
    expect(gs.values().some((v) => String((pdf.context.lookup(v) as PDFDict).get(PDFName.of('ca'))) === '0.5')).toBe(true);
    // リンクの注釈には印刷の印 (F = 4)
    const links = annots(pdf).filter((a) => String(a.get(PDFName.of('Subtype'))) === '/Link');
    expect(links.length).toBe(2);
    for (const a of links) expect(String(a.get(PDFName.of('F')))).toBe('4');
    // TrueType の書体のファイルに Length1
    const descs = [...pdf.context.enumerateIndirectObjects()].map(([, o]) => o).filter((o): o is PDFDict => o instanceof PDFDict && String(o.get(PDFName.of('Type'))) === '/FontDescriptor');
    expect(descs.length).toBeGreaterThan(0);
    for (const d of descs) {
      const f = d.lookup(PDFName.of('FontFile2'));
      if (f instanceof PDFRawStream) expect(Number(String(f.dict.get(PDFName.of('Length1'))))).toBe(decodePDFRawStream(f).decode().length);
    }
  });

  it('PDF/A-3b は pdfaid:part 3。題が無ければ題を書かない (PDF/X と違い Untitled にしない)', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont: loadCachedFont });
    const bytes = await r.toPdf({ pdfa: { version: 'A-3b' } });
    expect(await verifyPdfA(bytes, 3)).toEqual([]);
    const pdf = await load(bytes);
    expect(xmpOf(pdf)).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmpOf(pdf)).not.toContain('dc:title');
    expect(infoOf(pdf, 'Title')).toBeUndefined();
  });

  it('知らない版は誤りとして投げる', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont: loadCachedFont });
    await expect(r.toPdf({ pdfa: { version: 'A-1b' as never } })).rejects.toThrow(/A-2b・A-3b/);
  });

  it('PDF/A でない出力は変えない: 出力意図・XMP・AF・Length1・リンクの F を書かない', async () => {
    const r = await typesetHtml(html, { loadFont: loadCachedFont });
    const pdf = await load(await r.toPdf());
    expect(pdf.catalog.get(PDFName.of('OutputIntents'))).toBeUndefined();
    expect(pdf.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(pdf.catalog.get(PDFName.of('AF'))).toBeUndefined();
    for (const a of annots(pdf)) expect(a.get(PDFName.of('F'))).toBeUndefined();
    for (const [, o] of pdf.context.enumerateIndirectObjects()) if (o instanceof PDFRawStream) expect(o.dict.get(PDFName.of('Length1'))).toBeUndefined();
  });

  it('ファイルを開く動作 (Launch) は、links.launch で許しても書かない (警告する)。URI と文書の中のリンクは書く', async () => {
    const r = await typesetHtml('<p><a href="x.mp3">音</a> <a href="https://example.com/">外</a></p>', { loadFont: loadCachedFont, links: { launch: true } });
    const warnings: string[] = [];
    const bytes = await r.toPdf({ pdfa: { version: 'A-2b', warnings } });
    expect(warnings.join('\n')).toMatch(/Launch/);
    const pdf = await load(bytes);
    const actions = annots(pdf).map((a) => String(a.lookupMaybe(PDFName.of('A'), PDFDict)?.get(PDFName.of('S'))));
    expect(actions).toEqual(['/URI']);
    // PDF/A でなければ、これまでどおり Launch を書く
    const plain = await load(await r.toPdf());
    expect(annots(plain).map((a) => String(a.lookupMaybe(PDFName.of('A'), PDFDict)?.get(PDFName.of('S'))))).toContain('/Launch');
  });

  it('CMYK の色 (device-cmyk()) は RGB に直して書き (画面のプレビューと同じ式)、警告する。灰色 (K だけ) も RGB か DeviceGray', async () => {
    const r = await typesetHtml('<p style="color: device-cmyk(0 0.5 1 0)">色</p><p style="color: device-cmyk(0 0 0 0.6)">灰</p>', { loadFont: loadCachedFont });
    const warnings: string[] = [];
    const bytes = await r.toPdf({ pdfa: { version: 'A-2b', warnings } });
    expect(warnings.join('\n')).toMatch(/RGB に直しました/);
    const pdf = await load(bytes);
    const c = contentOf(pdf);
    expect(c).toMatch(/(^|\s)1 0\.5 0 rg/);
    expect(c).toMatch(/(^|\s)0\.4\d* (0\.4\d* 0\.4\d* rg|g)/);
    expect(c).not.toMatch(/(^|\s)k(\s|$)/);
    // PDF/A でなければ CMYK のまま
    expect(contentOf(await load(await r.toPdf()))).toMatch(/0 0\.5 1 0 k/);
  });

  it('特色 (Separation) の代わりの色空間は DeviceRGB にし、濃度の変換は白から代わりの色へ', async () => {
    const bytes = await foPdf(`<fo:block color="rgb-icc(255,0,0,#Separation,'DIC 156',1)">特色</fo:block>`, { pdfa: { version: 'A-2b' } }, { 'DIC 156': [0, 1, 1, 0] });
    expect(await verifyPdfA(bytes, 2)).toEqual([]);
    const pdf = await load(bytes);
    const cs = pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('ColorSpace'), PDFDict);
    const sep = pdf.context.lookup(cs.values()[0]) as PDFArray;
    expect(String(sep.get(2))).toBe('/DeviceRGB');
    const fn = pdf.context.lookup(sep.get(3)) as PDFDict;
    expect(String(fn.get(PDFName.of('C0')))).toBe('[ 1 1 1 ]');
    expect(String(fn.get(PDFName.of('C1')))).toBe('[ 1 0 0 ]');
  });

  it('字形の無い字 (.notdef) は描かずに警告する (内容の流れに CID 0 を書かない)', async () => {
    const r = await typesetHtml('<p>あ་い</p>', { loadFont: loadCachedFont });
    const warnings: string[] = [];
    const bytes = await r.toPdf({ pdfa: { version: 'A-2b', warnings } });
    expect(warnings.join('\n')).toMatch(/\.notdef/);
    expect(contentOf(await load(bytes))).not.toMatch(/<(?:[0-9A-F]{4})*0000/i);
    // PDF/A でなければ、これまでどおり字形の無い字の形で描く
    expect(contentOf(await load(await r.toPdf()))).toMatch(/<(?:[0-9A-F]{4})*0000/i);
  });
});

describe('PDF/A の注釈・フォーム・添付ファイル', () => {
  const notes =
    '<fo:block>注釈<fo:inline axf:annotation-type="Text" axf:annotation-contents="中身" axf:annotation-title="題" axf:annotation-color="#008080" axf:annotation-width="100pt" axf:annotation-height="80pt">ここ</fo:inline>と' +
    '<fo:inline axf:annotation-type="Stamp" axf:annotation-icon-name="Approved" axf:annotation-flags="Hidden" axf:annotation-width="80pt" axf:annotation-height="30pt">印</fo:inline>' +
    '<fo:inline axf:annotation-type="FreeText" axf:annotation-contents="中身" axf:annotation-width="80pt" axf:annotation-height="30pt">x</fo:inline></fo:block>';

  it('注釈に印刷の印を付けて隠す印を外し、外観 (AP の N だけ) を作る。テキストの注釈は NoZoom・NoRotate。Popup はそのまま', async () => {
    const bytes = await foPdf(notes, { pdfa: { version: 'A-2b' } });
    expect(await verifyPdfA(bytes, 2)).toEqual([]);
    const pdf = await load(bytes);
    const list = annots(pdf);
    const by = (t: string) => list.find((a) => String(a.get(PDFName.of('Subtype'))) === t)!;
    expect(String(by('/Text').get(PDFName.of('F')))).toBe(String(4 | 8 | 16));
    expect(String(by('/Stamp').get(PDFName.of('F')))).toBe('4');
    for (const t of ['/Text', '/Stamp', '/FreeText']) {
      const ap = by(t).lookup(PDFName.of('AP'), PDFDict);
      expect(ap.keys().map(String)).toEqual(['/N']);
      expect(ap.lookup(PDFName.of('N'))).toBeInstanceOf(PDFRawStream);
    }
    expect(by('/Popup')).toBeDefined();
    // PDF/A でなければ、これまでどおり (Text・Stamp に外観を作らない。Hidden のまま)
    const plain = await load(await foPdf(notes));
    const pb = (t: string) => annots(plain).find((a) => String(a.get(PDFName.of('Subtype'))) === t)!;
    expect(pb('/Text').get(PDFName.of('AP'))).toBeUndefined();
    expect(String(pb('/Stamp').get(PDFName.of('F')))).toBe('2');
  });

  it('フォームの欄は書かずに警告する (枠の見た目は残る)', async () => {
    const form = `<axf:form external-destination="url('https://example.com/submit')"><fo:block>名前 <axf:form-field axf:field-name="name" axf:field-type="text" axf:field-default-text="Your name" border="solid thin gray" width="50mm" height="6mm"/></fo:block>
      <fo:block><axf:form-field axf:field-type="button" axf:action-type="reset" axf:field-button-face="RESET" width="30mm" height="6mm"/></fo:block></axf:form>`;
    const warnings: string[] = [];
    const bytes = await foPdf(form, { pdfa: { version: 'A-2b', warnings } });
    expect(warnings.join('\n')).toMatch(/フォームの欄 \(2 件\)/);
    expect(await verifyPdfA(bytes, 2)).toEqual([]);
    const pdf = await load(bytes);
    expect(pdf.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
    expect(contentOf(pdf)).toMatch(/ re/);
  });

  const attach = '<fo:block axf:annotation-type="FileAttachment" axf:annotation-file-attachment="url(data/note.txt)" axf:annotation-file-name="メモ.txt">a</fo:block>';
  const assets = () => {
    const a = new AssetStore();
    a.registerFile('data/note.txt', new TextEncoder().encode('添付の中身'));
    return a;
  };

  it('PDF/A-3b: 添付ファイルを埋め込み、MIME の型・変えた日時・AFRelationship を書いて、カタログの AF から指す', async () => {
    const bytes = await foPdf(attach, { assets: assets(), pdfa: { version: 'A-3b' } });
    expect(await verifyPdfA(bytes, 3)).toEqual([]);
    const pdf = await load(bytes);
    const an = annots(pdf).find((a) => String(a.get(PDFName.of('Subtype'))) === '/FileAttachment')!;
    const fsRef = an.get(PDFName.of('FS'));
    expect(fsRef).toBeInstanceOf(PDFRef);
    const spec = pdf.context.lookup(fsRef) as PDFDict;
    expect(String(spec.get(PDFName.of('AFRelationship')))).toBe('/Unspecified');
    const ef = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')) as PDFRawStream;
    expect(String(ef.dict.get(PDFName.of('Subtype')))).toBe('/text#2Fplain');
    expect(ef.dict.lookup(PDFName.of('Params'), PDFDict).get(PDFName.of('ModDate'))).toBeDefined();
    expect(new TextDecoder().decode(decodePDFRawStream(ef).decode())).toBe('添付の中身');
    expect(pdf.catalog.lookup(PDFName.of('AF'), PDFArray).asArray().map(String)).toEqual([String(fsRef)]);
    expect(an.lookup(PDFName.of('AP'), PDFDict).keys().map(String)).toEqual(['/N']);
  });

  it('PDF/A-2b: 添付ファイルは埋め込まず (PDF/A のファイルのほかは埋め込めない)、テキストの注釈にして警告する', async () => {
    const warnings: string[] = [];
    const bytes = await foPdf(attach, { assets: assets(), pdfa: { version: 'A-2b', warnings } });
    expect(warnings.join('\n')).toMatch(/PDF\/A-3b/);
    expect(await verifyPdfA(bytes, 2)).toEqual([]);
    const pdf = await load(bytes);
    expect(annots(pdf).map((a) => String(a.get(PDFName.of('Subtype'))))).toEqual(['/Text', '/Popup']);
    for (const [, o] of pdf.context.enumerateIndirectObjects()) if (o instanceof PDFRawStream) expect(String(o.dict.get(PDFName.of('Type')))).not.toBe('/EmbeddedFile');
  });
});

describe('PDF/X と PDF/A を合わせる', () => {
  it('PDF/X-4 + PDF/A-2b: 出力意図を 2 つ (GTS_PDFX・GTS_PDFA1) 書き、同じプロファイルを指す。XMP に両方の印と、pdfxid と pdf:Trapped の拡張のスキーマ', async () => {
    const r = await typesetHtml('<title>題</title><p style="opacity: 0.5">本文</p>', { loadFont: loadCachedFont });
    const bytes = await r.toPdf({ pdfx: { version: 'X-4', profile: CMYK_PROFILE }, pdfa: { version: 'A-2b' } });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.6');
    expect(await verifyPdfA(bytes, 2)).toEqual([]);
    const pdf = await load(bytes);
    const intents = intentsOf(pdf);
    expect(intents.map((d) => String(d.get(PDFName.of('S'))))).toEqual(['/GTS_PDFX', '/GTS_PDFA1']);
    expect(String(intents[0].get(PDFName.of('DestOutputProfile')))).toBe(String(intents[1].get(PDFName.of('DestOutputProfile'))));
    expect(String((intents[1].lookup(PDFName.of('DestOutputProfile')) as PDFRawStream).dict.get(PDFName.of('N')))).toBe('4');
    const xmp = xmpOf(pdf);
    for (const s of ['<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>', '<pdfaid:part>2</pdfaid:part>', '<pdf:Trapped>False</pdf:Trapped>', '<pdfaSchema:namespaceURI>http://www.npes.org/pdfx/ns/id/</pdfaSchema:namespaceURI>', '<pdfaProperty:name>GTS_PDFXVersion</pdfaProperty:name>', '<pdfaSchema:namespaceURI>http://ns.adobe.com/pdf/1.3/</pdfaSchema:namespaceURI>', '<pdfaProperty:name>Trapped</pdfaProperty:name>'])
      expect(xmp).toContain(s);
    expect(infoOf(pdf, 'GTS_PDFXVersion')).toBe('PDF/X-4');
  });

  it('PDF/X-1a・X-3 + PDF/A-2b: 透明を平らにした PDF が、両方の検査に通る (PDF/X-1a・X-3 だけのときは書かない XMP も書く)', async () => {
    const r = await typesetHtml('<p style="opacity: 0.5; background: #c03020">半透明</p>', { loadFont: loadCachedFont });
    for (const version of ['X-1a', 'X-3'] as const) {
      const bytes = await r.toPdf({ pdfx: { version, profile: CMYK_PROFILE }, pdfa: { version: 'A-2b' } });
      expect(await verifyPdfA(bytes, 2)).toEqual([]);
      expect(xmpOf(await load(bytes))).toContain('<pdfaid:part>2</pdfaid:part>');
    }
  });

  it('出力の ICC プロファイルが無ければ、誤りとして投げる (2 つの出力意図に同じプロファイルを指させるため)', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont: loadCachedFont });
    await expect(r.toPdf({ pdfx: { version: 'X-3' }, pdfa: { version: 'A-2b' } })).rejects.toThrow(/ICC プロファイル/);
  });
});

describe('タグ付き PDF と合わせる', () => {
  it('タグ付き PDF (tagged) の構造の木を残したまま、PDF/A-2b の検査に通る', async () => {
    const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill-opacity="0.5"/></svg>');
    const r = await typesetHtml(`<title>題</title><h1>見出し</h1><p lang="en">text <a href="https://example.com/">link</a></p><ul><li>項目</li></ul><img alt="図" src="data:image/svg+xml,${svg}">`, { loadFont: loadCachedFont, tagged: true });
    const bytes = await r.toPdf({ pdfa: { version: 'A-2b' } });
    expect(await verifyPdfA(bytes, 2)).toEqual([]);
    const pdf = await load(bytes);
    expect(pdf.catalog.get(PDFName.of('StructTreeRoot'))).toBeDefined();
    const link = annots(pdf).find((a) => String(a.get(PDFName.of('Subtype'))) === '/Link')!;
    expect(String(link.get(PDFName.of('F')))).toBe('4');
    expect(link.get(PDFName.of('StructParent'))).toBeDefined();
  });
});

describe('書き出した PDF の検査 (pdfaVerify.ts)', () => {
  it('ふつうの PDF の違反 (メタデータ・出力意図・動作・注釈・色・描画の状態・画像・入れ子・埋め込みのファイル) を見つける', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([200, 200]);
    page.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: cmyk(0, 1, 1, 0) });
    page.drawRectangle({ x: 70, y: 10, width: 50, height: 50, color: rgb(1, 0, 0) });
    const ctx = pdf.context;
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: { S: 'Launch', F: PDFString.of('x.exe') } }), ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 30, 30], F: 4 })]));
    pdf.catalog.set(PDFName.of('Names'), ctx.obj({ JavaScript: ctx.obj({ Names: [] }) }));
    pdf.catalog.set(PDFName.of('AA'), ctx.obj({}));
    ctx.register(ctx.obj({ Type: 'ExtGState', TR: PDFName.of('Identity'), BM: PDFName.of('Foo') }));
    ctx.register(ctx.stream(new Uint8Array(3), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Interpolate: true }));
    ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of('a.txt'), EF: { F: ctx.register(ctx.stream(new Uint8Array(1), { Type: 'EmbeddedFile' })) } }));
    const deep = 'q '.repeat(30) + 'Q '.repeat(30);
    page.node.set(PDFName.of('Contents'), ctx.obj([page.node.get(PDFName.of('Contents'))!, ctx.register(ctx.stream(new TextEncoder().encode(deep)))].flatMap((c) => (c instanceof PDFArray ? c.asArray() : [c]))));
    const problems = (await verifyPdfA(await pdf.save(), 2)).join('\n');
    for (const re of [/XMP のメタデータ/, /PDF\/A の出力意図/, /Launch/, /JavaScript/, /追加の動作 \(AA\)/, /印刷の印/, /外観 \(AP\)/, /TR \(転送の関数\)/, /描画モード/, /Interpolate/, /28 段/, /PDF\/A-2 で埋め込めるのは/]) expect(problems).toMatch(re);
  });

  it('出力意図の色空間と違う機器による色を見つける (sRGB の出力意図に DeviceCMYK の k)', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont: loadCachedFont });
    const pdf = await load(await r.toPdf({ pdfa: { version: 'A-2b' } }));
    pdf.getPages()[0].drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: cmyk(0, 1, 1, 0) });
    const problems = (await verifyPdfA(await pdf.save(), 2)).join('\n');
    expect(problems).toMatch(/機器による色 \(k\)/);
    // Info と XMP の一致: pdf-lib が保存のときに書き換える Producer・日付は、XMP と違う
    const p2 = await load(await r.toPdf({ pdfa: { version: 'A-2b' } }));
    p2.setProducer('other');
    expect((await verifyPdfA(await p2.save({ updateFieldAppearances: false }), 2)).join('\n')).toMatch(/Producer/);
  });
});

describe('XMP の拡張のスキーマ (ISO 19005-2 §6.6.2.3.1)', () => {
  it('定義済みでない属性 (pdf:Trapped・pdfxid:GTS_PDFXVersion) を、拡張のスキーマで定義せずに書くと見つける', async () => {
    const r = await typesetHtml('<p>本文</p>', { loadFont: loadCachedFont });
    const pdf = await load(await r.toPdf({ pdfa: { version: 'A-2b' } }));
    const meta = pdf.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream;
    const xmp = new TextDecoder().decode(decodePDFRawStream(meta).decode()).replace('</rdf:Description>', '<pdf:Trapped>False</pdf:Trapped>\n</rdf:Description>');
    pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })));
    expect((await verifyPdfA(await pdf.save({ updateFieldAppearances: false }), 2)).join('\n')).toMatch(/pdf:Trapped/);
  });
});

describe('コマンドの --pdfa', () => {
  it('2b・3b を読み、知らない値は誤り。--pdfx と合わせるときは --output-profile が要る', () => {
    expect(parseArgs(['a.html', '--pdfa', '2b']).pdfa).toBe('A-2b');
    expect(parseArgs(['a.html', '--pdfa', 'PDF/A-3b']).pdfa).toBe('A-3b');
    expect(() => parseArgs(['a.html', '--pdfa', '1b'])).toThrow(/--pdfa/);
    expect(() => parseArgs(['a.html', '--pdfa', '2b', '--pdfx', 'x3'])).toThrow(/--output-profile/);
    // --output-profile は、これまでどおり --pdfx と一緒に使う
    expect(() => parseArgs(['a.html', '--pdfa', '2b', '--output-profile', 'package.json'])).toThrow(/--pdfx/);
  });
});

describe('PDF/A の確かめが調べる内容の流れ', () => {
  it('資源にじかに書いた Type3 の字形と、注釈の見え方 (AP の N・R・D。状態の辞書も) の色の命令を調べる', async () => {
    const r = await typesetHtml('<html lang="ja"><head><title>t</title></head><body><p>本文</p></body></html>', { loadFont: loadCachedFont });
    const bytes = await r.toPdf({ pdfa: { version: 'A-2b' } });
    expect(await verifyPdfA(bytes, 2)).toEqual([]);
    const tamper = async (change: (pdf: PDFDocument) => void) => {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      change(pdf);
      return verifyPdfA(await pdf.save({ useObjectStreams: false }), 2);
    };
    const cmyk = (pdf: PDFDocument) => pdf.context.register(pdf.context.flateStream(new TextEncoder().encode('0 0 0 1 k 0 0 1 1 re f\n'), { BBox: [0, 0, 1, 1] }));
    const t3 = await tamper((pdf) => {
      const res = pdf.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict);
      let fonts = res.lookup(PDFName.of('Font'));
      if (!(fonts instanceof PDFDict)) res.set(PDFName.of('Font'), (fonts = pdf.context.obj({})));
      (fonts as PDFDict).set(PDFName.of('T3'), pdf.context.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1, 1], FontMatrix: [1, 0, 0, 1, 0, 0], CharProcs: { a: cmyk(pdf) }, FirstChar: 97, LastChar: 97, Widths: [1], Resources: {} } as never));
    });
    expect(t3.join('\n')).toMatch(/機器による色 \(k\)/);
    for (const key of ['N', 'R', 'D']) {
      const ap = await tamper((pdf) => {
        const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'));
        const list = annots instanceof PDFArray ? annots : pdf.context.obj([]);
        list.push(pdf.context.obj({ Type: 'Annot', Subtype: 'Square', F: 4, Rect: [0, 0, 1, 1], AP: { [key]: key === 'N' ? cmyk(pdf) : { Off: cmyk(pdf) } } } as never));
        pdf.getPage(0).node.set(PDFName.of('Annots'), list);
      });
      expect(ap.join('\n')).toMatch(/機器による色 \(k\)/);
    }
  });
});
