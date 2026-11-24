/**
 * 同じ入力から同じバイトの PDF を作ること: PDF の作成日・更新日 (PdfOptions.date・コマンドの SOURCE_DATE_EPOCH) と、
 * 毎回変わっていた所 (文書の ID・Type 2 の字形の random・PostScript の realtime) を中身から作ること。
 * 時計は vi.useFakeTimers で 1 度ごとに違う時刻にし、時計が進むのを待たない (機械の速さに頼らない)。
 * 乱数も 1 度ごとに違う値を返すように差し替え、乱数を使っていないことを確かめる
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import { sourceDateEpoch, UsageError } from '../src/cli';
import { DEFAULT_FONTS, KumioriOptionError, typesetToPdf } from '../src/index';
import { runInNewContext } from 'node:vm';
import { importXslFo } from '../src/xslfoImport';
import { renderPdf, type PdfRenderOptions } from '../src/pdfRenderer';
import { AssetStore } from '../src/assets';
import { cffGlyph, type CffFont } from '../src/psCff';
import { Interp, latin1 } from '../src/psInterp';
import { ensureFonts, loadCachedFont, makeEngine } from './helpers';

const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
const fo = (body: string) =>
  `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="150mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
  `<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">${body}</fo:flow></fo:page-sequence></fo:root>`;
const attach = '<fo:block>本文<fo:inline axf:annotation-type="FileAttachment" axf:annotation-file-attachment="url(data/note.txt)" axf:annotation-file-name="note.txt">a</fo:inline></fo:block>';
const assets = () => {
  const a = new AssetStore();
  a.registerFile('data/note.txt', new TextEncoder().encode('添付の中身'));
  return a;
};

let E: Awaited<ReturnType<typeof makeEngine>>;
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
  E = await makeEngine();
}, 300_000);
afterEach(() => vi.useRealTimers());

/** 乱数 (crypto.getRandomValues・Math.random) を、seed から始まる毎回違う値に差し替える */
const scrambleRandom = (seed: number) => {
  let x = seed | 1;
  const next = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x);
  vi.spyOn(Math, 'random').mockImplementation(() => next() / 0x80000000);
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength).forEach((_, i, b) => (b[i] = next() & 0xff));
    return a;
  });
};
/** 時計を now (ミリ秒) にし、乱数を now から始まる値にして、XSL-FO を組んで PDF にする */
const pdfAt = async (now: number, body: string, opts: PdfRenderOptions = {}) => {
  vi.useFakeTimers({ toFake: ['Date'], now });
  scrambleRandom(now);
  try {
    return await renderPdf(E.engine.layout(importXslFo(fo(body), parse, opts.pdfua ? { tagged: true } : {}).document), E.fonts, opts);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
};
const T1 = Date.UTC(2030, 5, 6, 7, 8, 9);
const T2 = Date.UTC(2031, 7, 8, 9, 10, 11);
const latin = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
/** trailer の ID の 2 つ (16 進) */
const trailerIds = (pdf: PDFDocument) => (pdf.context.trailerInfo.ID as unknown as { asArray(): PDFHexString[] }).asArray().map((h) => h.asString());
const infoOf = (pdf: PDFDocument, key: string) => {
  const v = (pdf.context.lookup(pdf.context.trailerInfo.Info) as PDFDict).lookup(PDFName.of(key));
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
};
const xmpOf = (pdf: PDFDocument) => {
  const s = pdf.catalog.lookup(PDFName.of('Metadata'));
  return s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : '';
};
/** 埋め込んだファイルの流れの Params の ModDate */
const attachedModDates = (pdf: PDFDocument) =>
  pdf.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFRawStream => o instanceof PDFRawStream && String(o.dict.get(PDFName.of('Type'))) === '/EmbeddedFile')
    .map((s) => (s.dict.lookup(PDFName.of('Params'), PDFDict).lookup(PDFName.of('ModDate')) as PDFString | undefined)?.asString());

const DATE = new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 678));

describe('PDF の作成日・更新日 (PdfOptions.date)', () => {
  it('ふつうの PDF: Info の CreationDate・ModDate に、渡した日時を秒に切って書く (時計によらない)', async () => {
    for (const now of [Date.UTC(2030, 5, 6), Date.UTC(2031, 7, 8)]) {
      const pdf = await PDFDocument.load(await pdfAt(now, '<fo:block>本文</fo:block>', { date: DATE }), { updateMetadata: false });
      expect(infoOf(pdf, 'CreationDate')).toBe('D:20240102030405Z');
      expect(infoOf(pdf, 'ModDate')).toBe('D:20240102030405Z');
    }
  });

  it('渡さなければ、書き出すときの時刻 (秒に切ったもの)', async () => {
    const pdf = await PDFDocument.load(await pdfAt(Date.UTC(2030, 5, 6, 7, 8, 9, 500), '<fo:block>本文</fo:block>'), { updateMetadata: false });
    expect(infoOf(pdf, 'CreationDate')).toBe('D:20300606070809Z');
    expect(infoOf(pdf, 'ModDate')).toBe('D:20300606070809Z');
  });

  it('PDF/A-3b + PDF/UA: Info・XMP の日付と、添付ファイルの ModDate に、同じ日時を書く', async () => {
    const pdf = await PDFDocument.load(await pdfAt(Date.UTC(2030, 5, 6), attach, { date: DATE, assets: assets(), pdfa: { version: 'A-3b' }, pdfua: {} }), { updateMetadata: false });
    expect(infoOf(pdf, 'CreationDate')).toBe('D:20240102030405Z');
    expect(infoOf(pdf, 'ModDate')).toBe('D:20240102030405Z');
    const xmp = xmpOf(pdf);
    for (const p of ['xmp:CreateDate', 'xmp:ModifyDate', 'xmp:MetadataDate']) expect(xmp, p).toContain(`<${p}>2024-01-02T03:04:05Z</${p}>`);
    expect(attachedModDates(pdf)).toEqual(['D:20240102030405Z']);
  });

  it('正しくない Date・0〜9999 年の外は、選択肢の誤り (option は date)', async () => {
    for (const date of [new Date(NaN), new Date(Date.UTC(10000, 0, 1)), 'x' as never]) {
      const e = await pdfAt(0, '<fo:block>本文</fo:block>', { date }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(KumioriOptionError);
      expect((e as KumioriOptionError).option).toBe('date');
    }
  });

  it('typesetToPdf は、正しくない date を組む前に誤りにする。別の realm (vm) の Date は受ける', async () => {
    const onProgress = vi.fn();
    const e = await typesetToPdf(fo('<fo:block>本文</fo:block>'), { loadFont: loadCachedFont, onProgress }, { date: new Date(NaN) }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(KumioriOptionError);
    expect((e as KumioriOptionError).option).toBe('date');
    // 組み始めていない (進み具合を 1 度も知らせない)
    expect(onProgress).not.toHaveBeenCalled();
    const other = runInNewContext('new Date(Date.UTC(2024, 0, 2, 3, 4, 5))') as Date;
    expect(other instanceof Date).toBe(false);
    const pdf = await PDFDocument.load(await pdfAt(0, '<fo:block>本文</fo:block>', { date: other }), { updateMetadata: false });
    expect(infoOf(pdf, 'CreationDate')).toBe('D:20240102030405Z');
  });

  it('Symbol.toStringTag を Date に偽った値は、TypeError でなく date の KumioriOptionError にする', async () => {
    const fake = { [Symbol.toStringTag]: 'Date' } as unknown as Date;
    const e = await typesetToPdf(fo('<fo:block>本文</fo:block>'), { loadFont: loadCachedFont }, { date: fake }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(KumioriOptionError);
    expect((e as KumioriOptionError).option).toBe('date');
  });
});

describe('同じ入力・同じ日時から同じバイトの PDF', () => {
  const body = '<fo:block font-family="serif">本文 Text <fo:inline font-weight="bold">太字</fo:inline></fo:block>';
  for (const [name, opts, b] of [
    ['ふつうの PDF', {}, body],
    ['PDF/A-3b + PDF/UA + 添付ファイル', { pdfa: { version: 'A-3b' }, pdfua: {} }, body + attach],
    ['PDF/X-1a', { pdfx: { version: 'X-1a' } }, body],
  ] as const) {
    it(`${name}: 時計と乱数が違っても、同じバイトになる`, async () => {
      const o = (): PdfRenderOptions => ({ ...opts, date: DATE, assets: assets() }) as PdfRenderOptions;
      const a = await pdfAt(T1, b, o());
      const c = await pdfAt(T2, b, o());
      expect(a.length).toBe(c.length);
      expect(Buffer.from(a).equals(Buffer.from(c))).toBe(true);
    });
  }

  it('文書の ID: trailer の 2 つと XMP の DocumentID・InstanceID が同じ値で、中身から作る (印の値は残らない。中身が違えば違う)', async () => {
    const a = await pdfAt(T1, body, { date: DATE, pdfa: { version: 'A-2b' } });
    const pdf = await PDFDocument.load(a, { updateMetadata: false });
    const [id1, id2] = trailerIds(pdf);
    expect(id1).toMatch(/^[0-9a-f]{32}$/);
    expect(id2).toBe(id1);
    const uuid = id1.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const xmp = xmpOf(pdf);
    expect(xmp).toContain(`<xmpMM:DocumentID>uuid:${uuid}</xmpMM:DocumentID>`);
    expect(xmp).toContain(`<xmpMM:InstanceID>uuid:${uuid}</xmpMM:InstanceID>`);
    expect(latin(a)).not.toContain('4b756d696f72692d646f632d69642d00');
    // 日時が違えば中身が違うので、ID も違う。本文が違っても違う
    const other = [await pdfAt(T1, body, { date: new Date(0), pdfa: { version: 'A-2b' } }), await pdfAt(T1, '<fo:block>別</fo:block>', { date: DATE, pdfa: { version: 'A-2b' } })];
    for (const o of other) expect(trailerIds(await PDFDocument.load(o, { updateMetadata: false }))[0]).not.toBe(id1);
  });

  it('PDF/X-1a・X-3: 平文の文字列 (出力の条件の説明) に印の値と同じ字があっても、trailer と XMP の印だけを書き換える', async () => {
    const mark = '4b756d696f72692d646f632d69642d00';
    const uuidMark = mark.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const condition = `x <${mark}> uuid:${uuidMark}<`;
    for (const version of ['X-1a', 'X-3'] as const) {
      // 前は、印が 3 つ見つかって、名前の無い Error で止まった
      const a = await pdfAt(T1, body, { date: DATE, pdfx: { version, info: condition } } as PdfRenderOptions);
      const pdf = await PDFDocument.load(a, { updateMetadata: false });
      const [id1, id2] = trailerIds(pdf);
      expect(id1).toMatch(/^[0-9a-f]{32}$/);
      expect(id1).not.toBe(mark);
      expect(id2).toBe(id1);
      // 利用者の値はそのまま
      expect(latin(a)).toContain(condition);
    }
  });

  it('日時を渡さないふつうの PDF も、ID は乱数でなく中身から作る (同じ時刻の 2 度は同じバイト)', async () => {
    const a = await pdfAt(T1, body);
    const c = await pdfAt(T1, body);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(true);
  });
});

describe('PostScript・CFF の毎回変わっていた値', () => {
  // 字形の手続き: 0 0 rmoveto, random 100 mul 0 rlineto, 0 100 rlineto, endchar (Type 2 Charstring Format の random は escape 23・mul は escape 24)
  const font = (): CffFont => ({
    name: 'R', cid: false, charStrings: [Uint8Array.of(139, 139, 21, 12, 23, 239, 12, 24, 139, 5, 139, 239, 5, 14)], gsubrs: [], charset: [0],
    encoding: new Map(), byName: new Map(), byCid: new Map(), fontMatrix: [0.001, 0, 0, 0.001, 0, 0], fontBBox: [0, 0, 100, 100], paintType: 0,
    fdSelect: () => 0, privates: [{ subrs: [], defaultWidthX: 0, nominalWidthX: 0 }], fdMatrices: [], strings: () => '', charstringType: 2,
  });
  it('Type 2 の random: 乱数によらず、同じ字形は同じ形 (値は 0 より大きく 1 以下)', () => {
    const shapes = [1, 2].map((seed) => {
      scrambleRandom(seed);
      try {
        return JSON.stringify(cffGlyph(font(), 0));
      } finally {
        vi.restoreAllMocks();
      }
    });
    expect(shapes[1]).toBe(shapes[0]);
    const x = (JSON.parse(shapes[0]).segs as Array<{ op: string; x?: number }>).find((s) => s.op === 'L')!.x!;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThanOrEqual(100);
  });
  it('realtime: 時計によらず、手続きの歩数から作る', () => {
    const values = [T1, T2].map((now) => {
      vi.useFakeTimers({ toFake: ['Date'], now });
      try {
        const I = new Interp({ maxMillis: 5000 });
        expect(I.run(latin1('realtime 10 { 1 pop } repeat realtime'))).toBeUndefined();
        return I.ostack.map((o) => (o as { v: number }).v);
      } finally {
        vi.useRealTimers();
      }
    });
    expect(values[1]).toEqual(values[0]);
    expect(values[0][1]).toBeGreaterThan(values[0][0]);
  });
});

describe('コマンドの SOURCE_DATE_EPOCH', () => {
  it('1970-01-01 UTC からの秒の整数を読む。無ければ undefined', () => {
    expect(sourceDateEpoch({})).toBeUndefined();
    expect(sourceDateEpoch({ SOURCE_DATE_EPOCH: '1700000000' })?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(sourceDateEpoch({ SOURCE_DATE_EPOCH: '0' })?.getTime()).toBe(0);
    expect(sourceDateEpoch({ SOURCE_DATE_EPOCH: '253402300799' })?.toISOString()).toBe('9999-12-31T23:59:59.000Z');
  });
  it('決まりに合わない値 (空・符号・小数・数でない字・9999 年より後) は誤り', () => {
    for (const v of ['', '-1', '+1', '1.5', '1e9', ' 1', 'abc', '253402300800']) expect(() => sourceDateEpoch({ SOURCE_DATE_EPOCH: v }), v).toThrow(UsageError);
  });
});
