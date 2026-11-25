/**
 * JPEG の埋め込み (imageEmbed.ts の embedJpeg) の確かめ。
 *  - 灰・RGB・CMYK の JPEG は、いままでの埋め込み (pdf-lib の embedJpg) と同じ番号・同じ辞書・同じ流れ (ファイルそのまま) になる
 *  - 頭 (SOF) の前の詰め物の 0xFF・長さの無い印・SOF でない C4・C8・CC の印 (ITU-T T.81 §B.1.1.2・表 B.1) を読み飛ばす。
 *    大きなバイト列の途中を指す JPEG (subarray) も、その位置から読む
 *  - 頭の読めない JPEG・成分の数が 1・3・4 でない JPEG は投げる
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream, type PDFRef } from 'pdf-lib';
import { embedJpeg } from '../src/imageEmbed';

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
/** JPEG の頭だけの列 (SOI・APP0・DQT・SOF・SOS の頭・少しのデータ・EOI)。sof は SOF の印、comps は成分の数 */
function jpeg(o: { sof?: number; comps?: number; width?: number; height?: number; precision?: number; before?: number[] } = {}): Uint8Array {
  const { sof = 0xc0, comps = 3, width = 321, height = 123, precision = 8, before = [] } = o;
  const sofBody = [precision, height >> 8, height & 255, width >> 8, width & 255, comps, ...Array.from({ length: comps }, (_, i) => [i + 1, 0x11, 0]).flat()];
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xdb, [0, ...Array.from({ length: 64 }, () => 1)]),
    ...before,
    ...seg(sof, sofBody),
    ...seg(0xda, [comps, ...Array.from({ length: comps }, (_, i) => [i + 1, 0]).flat(), 0, 63, 0]),
    1, 2, 3, 0xff, 0x00, 4,
    0xff, 0xd9,
  ]);
}

/** 文書の中の流れの、番号・辞書・中身 */
function streamOf(pdf: PDFDocument, ref: PDFRef) {
  const s = pdf.context.lookup(ref) as PDFRawStream;
  expect(s).toBeInstanceOf(PDFRawStream);
  return { ref: ref.toString(), dict: s.dict.toString(), contents: Buffer.from(s.contents).toString('hex') };
}

describe('JPEG の埋め込み (embedJpeg)', () => {
  for (const [name, comps] of [['灰', 1], ['RGB', 3], ['CMYK', 4]] as const)
    it(`${name} の JPEG: pdf-lib の embedJpg と同じ番号・辞書・流れ`, async () => {
      const b = jpeg({ comps });
      const theirs = await PDFDocument.create();
      const img0 = await theirs.embedJpg(b);
      await img0.embed();
      const ours = await PDFDocument.create();
      const img = embedJpeg(ours, b);
      expect([img.width, img.height]).toEqual([321, 123]);
      expect([img.width, img.height]).toEqual([img0.width, img0.height]);
      expect(streamOf(ours, img.ref)).toEqual(streamOf(theirs, img0.ref));
      if (comps === 4) expect(streamOf(ours, img.ref).dict).toContain('/Decode [ 1 0 1 0 1 0 1 0 ]');
    });

  it('SOF の前の詰め物の 0xFF・長さの無い印 (RST)・SOF でない C4 (DHT)・CC (DAC) を飛ばし、プログレッシブ (C2) の頭も読む', () => {
    const before = [0xff, 0xff, ...seg(0xc4, [0, 1, 2]), 0xff, 0xd0, ...seg(0xcc, [0, 0x10])];
    const pdf = PDFDocument.create();
    return pdf.then((doc) => {
      const img = embedJpeg(doc, jpeg({ sof: 0xc2, before, width: 77, height: 55 }));
      expect([img.width, img.height]).toEqual([77, 55]);
      expect(streamOf(doc, img.ref).dict).toContain('/ColorSpace /DeviceRGB');
    });
  });

  it('大きなバイト列の途中を指す JPEG も、その位置から読む', async () => {
    const b = jpeg({ width: 40, height: 30 });
    const big = new Uint8Array(b.length + 100);
    big.set(b, 100);
    const pdf = await PDFDocument.create();
    const img = embedJpeg(pdf, big.subarray(100));
    expect([img.width, img.height]).toEqual([40, 30]);
    expect(streamOf(pdf, img.ref).contents).toBe(Buffer.from(b).toString('hex'));
  });

  it('頭の読めない JPEG・成分の数が 1・3・4 でない JPEG は投げる', async () => {
    const pdf = await PDFDocument.create();
    expect(() => embedJpeg(pdf, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/SOF/);
    expect(() => embedJpeg(pdf, Uint8Array.from([0x89, 0x50]))).toThrow(/SOF/);
    // SOF より先に SOS が来る
    const noSof = Uint8Array.from([0xff, 0xd8, ...seg(0xda, [1, 1, 0, 0, 63, 0]), 0xff, 0xd9]);
    expect(() => embedJpeg(pdf, noSof)).toThrow(/SOF/);
    expect(() => embedJpeg(pdf, jpeg({ comps: 2 }))).toThrow(/成分の数 2/);
  });
});
