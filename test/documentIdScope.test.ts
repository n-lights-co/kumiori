/**
 * 文書の ID の印を探す範囲 (src/pdfStandard.ts の finishDocumentId・DocumentIdStream) の確かめ。
 * 印は、Kumiori が書いた所 (trailer・相互参照の流れの辞書と、XMP の流れ) だけで探し、利用者のバイト列 (画像の中身など) の中の字は数えない。
 *  - XMP の包みの始まりと終わりの字を並べた JPEG でも、印を探す手間が字の数の積にならない (同じ大きさのふつうの JPEG と比べて縛る)
 *  - JPEG の中に XMP の包みと印の字があっても、PDF を作れ (流さない・PDF/UA-1・流し書き)、ID が書き換わる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, typesetToPdf, typesetToPdfStream } from '../src/index';
import { DOCUMENT_ID_MARK } from '../src/pdfStandard';
import { encodeJpeg } from '../src/jpeg';
import { ensureFonts, loadCachedFont } from './helpers';
import { expectRatio } from './timing';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const DATE = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));
const uuid = DOCUMENT_ID_MARK.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

/** 小さな JPEG の SOI の後に、COM の区切り (JPEG §B.2.4.5。中身は任意のバイト) を足したもの */
function jpegWithComments(texts: string[]): Uint8Array {
  const base = encodeJpeg({ width: 2, height: 2, components: 3, data: new Uint8Array(12).fill(128) });
  const segs = texts.map((t) => {
    const body = new TextEncoder().encode(t);
    const seg = new Uint8Array(body.length + 4);
    seg.set([0xff, 0xfe, (body.length + 2) >> 8, (body.length + 2) & 255]);
    seg.set(body, 4);
    return seg;
  });
  const total = base.length + segs.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(total);
  out.set(base.subarray(0, 2));
  let at = 2;
  for (const s of segs) {
    out.set(s, at);
    at += s.length;
  }
  out.set(base.subarray(2), at);
  return out;
}
const html = (jpeg: Uint8Array) => `<!doctype html><html lang="ja"><head><title>t</title></head><body><p>あ<img src="data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}" alt="図"></p></body></html>`;
const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

describe('文書の ID の印は、Kumiori が書いた所だけで探す', () => {
  it('XMP の包みの始まりと終わりの字を並べた JPEG でも、手間が積にならない', async () => {
    const seg = (s: string) => Array.from({ length: 40 }, () => s.repeat(2000));
    const bad = html(jpegWithComments(seg('<?xpacket begin=<?xpacket end=')));
    const plain = html(jpegWithComments(seg('x'.repeat('<?xpacket begin=<?xpacket end='.length))));
    const run = (t: string) => () => typesetToPdf(t, { loadFont: loadCachedFont, pdfua: true }, { date: DATE });
    await expectRatio(2, run(bad), run(plain), { label: 'XMP の包みの字を並べた JPEG' });
  }, 300_000);

  it('JPEG の中の XMP の包みと印の字は数えず、PDF を作れて、ID を書き換える (流さない・PDF/UA-1・流し書き)', async () => {
    const t = html(jpegWithComments([`<?xpacket begin="" ?> uuid:${uuid}< <${DOCUMENT_ID_MARK}> <?xpacket end="w"?>`]));
    const check = (pdf: Uint8Array) => {
      const s = latin1(pdf);
      // 利用者のバイト列の中の字は、そのまま残る (書き換えない)
      expect(s).toContain(`uuid:${uuid}<`);
      // trailer の ID は書き換わる
      expect(s).toMatch(/\/ID \[ <[0-9a-f]{32}> <[0-9a-f]{32}> \]/);
      expect(s.match(/\/ID \[ <([0-9a-f]{32})>/)![1]).not.toBe(DOCUMENT_ID_MARK);
    };
    const plain = (await typesetToPdf(t, { loadFont: loadCachedFont }, { date: DATE })).pdf;
    check(plain);
    const ua = (await typesetToPdf(t, { loadFont: loadCachedFont, pdfua: true }, { date: DATE })).pdf;
    check(ua);
    // XMP の流れの印は書き換わる (DocumentID・InstanceID)
    expect(latin1(ua).match(/xmpMM:DocumentID>uuid:([0-9a-f-]+)</)![1]).not.toBe(uuid);
    const parts: Uint8Array[] = [];
    await typesetToPdfStream(t, { loadFont: loadCachedFont, pdfua: true }, (c) => void parts.push(c), { date: DATE });
    const streamed = Buffer.concat(parts);
    check(streamed);
    expect(streamed.equals(Buffer.from(ua))).toBe(true);
  });
});
