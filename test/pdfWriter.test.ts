/**
 * PDF の書き出しの層 (src/pdfWriter.ts) の確かめ。
 *  - 自前の書き手 (writePdf) は、pdf-lib の PDFDocument.save (と、前の版の書き換え・圧縮の関数の差し替え) と、1 バイトも違わない PDF を書く。
 *    組版の API で、PDF の機能を広く使う文書 (PDF/X・PDF/A・タグ付き PDF・PDF/UA-1・圧縮の関数・縦書き・SVG・PNG の各形・JPEG・PDF の画像・
 *    リンク・しおり・フォームの欄・添付) を、両方の書き方で書いて比べる
 *  - ページの無い文書 (1 枚足す)・オブジェクトの流れの区切り (50 個ちょうど・51 個)・相互参照の表の書き方も、save と同じ
 *  - 先に書いた流れ (PdfWriter の release) があっても、save と同じバイト列。切れ目より後ろの流れは待たせる
 *  - まとめて先に書く口 (releaseAll・defer) と、書き出し先へ流す形 (流した塊を繋ぐと、流さずに書いたものと同じ)
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { Cache, PDFDocument, PDFFlateStream, PDFInvalidObject, PDFRef, StandardFonts } from 'pdf-lib';
import { DEFAULT_FONTS, typesetToPdf, type PdfOptions, type TypesetOptions } from '../src/index';
import { PdfWriter, writePdf, __setPdfWriterForTest, type PdfWriteOptions } from '../src/pdfWriter';
import { PdfOutputPort } from '../src/pdfOutput';
import { encodeJpeg } from '../src/jpeg';
import { encodePng } from '../src/pixels';
import { makePdf } from './pdfImageFixtures';
import { ensureFonts, loadCachedFont } from './helpers';
import { testIccProfile } from './iccTestProfile';

/** 前の書き方: pdf-lib の save と、前の pdfLibPatches.ts の useDeflate (flush の後に、圧縮する流れの覚えを差し替える)・版の書き換え */
async function legacySave(pdf: PDFDocument, o: PdfWriteOptions): Promise<Uint8Array> {
  if (o.deflate) {
    const deflate = o.deflate;
    await pdf.flush();
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFFlateStream)) continue;
      const s = obj as unknown as { encode: boolean; contentsCache: Cache<Uint8Array>; getUnencodedContents(): Uint8Array };
      if (s.encode) s.contentsCache = Cache.populatedBy(() => deflate(s.getUnencodedContents()));
    }
  }
  const bytes = await pdf.save({ useObjectStreams: o.objectStreams ?? true, addDefaultPage: o.addDefaultPage ?? true });
  if (o.version && o.version !== '1.7') bytes.set(new TextEncoder().encode(`%PDF-${o.version}`), 0);
  return bytes;
}

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);
afterEach(() => __setPdfWriterForTest(undefined));

const DATE = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));
const uri = (mime: string, b: Uint8Array) => `data:${mime};base64,${Buffer.from(b).toString('base64')}`;

/** 両方の書き方で組んで、PDF のバイト列を返す */
async function both(text: string, name: string, pdf: PdfOptions = {}, files: { name: string; data: Uint8Array }[] = [], set: TypesetOptions = {}): Promise<[Uint8Array, Uint8Array]> {
  const run = async () => (await typesetToPdf(text, { name, files, loadFont: loadCachedFont, ...set }, { date: DATE, ...pdf })).pdf;
  __setPdfWriterForTest(undefined);
  const mine = await run();
  __setPdfWriterForTest(legacySave);
  const theirs = await run();
  __setPdfWriterForTest(undefined);
  return [mine, theirs];
}
const same = ([a, b]: [Uint8Array, Uint8Array]) => {
  expect(a.length).toBe(b.length);
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
};

describe('自前の書き手は、pdf-lib の save と同じバイト列の PDF を書く', () => {
  let html = '';
  let files: { name: string; data: Uint8Array }[] = [];
  beforeAll(async () => {
    const px = (w: number, h: number, f: (x: number, y: number) => number[]) => {
      const rgba = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(f(x, y), (y * w + x) * 4);
      return { width: w, height: h, rgba };
    };
    const alphaPng = await encodePng(px(20, 10, (x, y) => [x * 12, y * 20, 100, x % 2 ? 255 : 80]));
    const rgbPng = await encodePng(px(20, 10, (x, y) => [x * 12, y * 20, 100, 255]));
    const jpeg = encodeJpeg({ width: 16, height: 8, components: 3, data: new Uint8Array(16 * 8 * 3).map((_, i) => (i * 7) & 255) });
    files = [{ name: 'p.pdf', data: await makePdf([{ media: [0, 0, 144, 72] }]) }];
    html =
      '<!doctype html><html lang="ja"><head><title>書き手</title><style>.v { writing-mode: vertical-rl; height: 6em }</style></head><body>' +
      '<h1 id="top">見出し</h1><p>本文 <b>太字</b> <a href="https://example.com/">外へ</a> <a href="#top">上へ</a></p>' +
      `<p><img src="${uri('image/png', alphaPng)}" alt="α"> <img src="${uri('image/png', rgbPng)}" alt="RGB"> <img src="${uri('image/jpeg', jpeg)}" alt="JPEG"> <img src="p.pdf" alt="PDF"></p>` +
      '<svg width="60" height="30" viewBox="0 0 60 30"><rect width="60" height="30" fill="#c00" opacity="0.5"/><text x="5" y="20">字</text></svg>' +
      '<div class="v">縦書きの段落。</div>' +
      Array.from({ length: 30 }, (_, i) => `<h2>節 ${i + 1}</h2><p>段落 ${i + 1}。</p>`).join('') +
      '</body></html>';
  });

  const z9 = (d: Uint8Array) => deflateSync(d, { level: 9 });
  const cmyk = () => testIccProfile({ colorSpace: 'CMYK' });
  const cases: [string, PdfOptions, TypesetOptions][] = [
    ['ふつうの PDF (タグ付き)', {}, {}],
    ['タグを付けない PDF', {}, { tagged: false }],
    ['PDF/UA-1', {}, { pdfua: true }],
    ['圧縮の関数を渡した PDF', {}, { deflate: z9 }],
    ['PDF/X-1a (相互参照の表・PDF 1.3)', { pdfx: { version: 'X-1a' } }, {}],
    ['PDF/X-3 (相互参照の表・PDF 1.4) と圧縮の関数', { pdfx: { version: 'X-3' } }, { deflate: z9 }],
    ['PDF/X-4 (PDF 1.6)', { pdfx: { version: 'X-4', profile: cmyk() } }, {}],
    ['PDF/A-2b', { pdfa: { version: 'A-2b' } }, {}],
    ['PDF/A-3b と PDF/UA-1', { pdfa: { version: 'A-3b' } }, { pdfua: true }],
    ['PDF/X-4 と PDF/A-2b と圧縮の関数', { pdfx: { version: 'X-4', profile: cmyk() }, pdfa: { version: 'A-2b' } }, { deflate: (d) => deflateSync(d) }],
  ];
  for (const [name, o, set] of cases)
    it(`HTML: ${name}`, async () => {
      same(await both(html, 'w.html', o, files, set));
    });

  it('XSL-FO: しおり・フォームの欄・添付・リンク', async () => {
    const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
    const fo =
      `<?xml version="1.0"?><fo:root ${NS}><fo:layout-master-set><fo:simple-page-master master-name="m" page-width="150mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>` +
      '<fo:bookmark-tree><fo:bookmark internal-destination="a"><fo:bookmark-title>あ</fo:bookmark-title></fo:bookmark></fo:bookmark-tree>' +
      '<fo:page-sequence master-reference="m"><fo:flow flow-name="xsl-region-body">' +
      '<fo:block id="a">本文<fo:basic-link external-destination="url(https://example.com/)">リンク</fo:basic-link></fo:block>' +
      '<fo:block><axf:form-field field-type="text" field-name="t" field-default-text="hello" width="100pt" height="12pt"/>' +
      '<axf:form-field field-type="checkbox" field-name="c" field-checked="true"/></fo:block>' +
      '<fo:block>添付<fo:inline axf:annotation-type="FileAttachment" axf:annotation-file-attachment="url(note.txt)" axf:annotation-file-name="note.txt">a</fo:inline></fo:block>' +
      '</fo:flow></fo:page-sequence></fo:root>';
    const note = [{ name: 'note.txt', data: new TextEncoder().encode('添付の中身') }];
    same(await both(fo, 'w.fo', {}, note));
    same(await both(fo, 'w.fo', { pdfa: { version: 'A-3b' } }, note));
  });
});

describe('save と同じ書き方 (文書を直に作る)', () => {
  /** n 個の辞書 (流れでないもの) と流れ 1 つを持つ文書。ページは pages 枚 */
  const make = async (n: number, pages = 1) => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    for (let i = 0; i < pages; i++) pdf.addPage([100, 100]).drawText('x', { font: await pdf.embedFont(StandardFonts.Helvetica) });
    for (let i = 0; i < n; i++) pdf.context.register(pdf.context.obj({ K: i }));
    return pdf;
  };
  const compare = async (f: () => Promise<PDFDocument>, o: PdfWriteOptions = {}) => {
    const a = await writePdf(await f(), o);
    const b = await legacySave(await f(), o);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    return a;
  };

  it('ページの無い文書は 1 枚足す (addDefaultPage)。足さないときは足さない', async () => {
    const a = await compare(() => make(0, 0));
    expect((await PDFDocument.load(a)).getPageCount()).toBe(1);
    const b = await compare(() => make(0, 0), { addDefaultPage: false, objectStreams: false });
    expect((await PDFDocument.load(b, { ignoreEncryption: true })).getPageCount()).toBe(0);
  });

  it('オブジェクトの流れの区切り (流れでないものが 50 個・100 個の前後) と、相互参照の表', async () => {
    // 足す辞書のほかに、カタログ・ページの木・ページ・書体などがあるので、区切りをまたぐように数を振る
    for (const n of [...Array.from({ length: 12 }, (_, i) => 40 + i), ...Array.from({ length: 6 }, (_, i) => 92 + i)]) {
      await compare(() => make(n));
      await compare(() => make(n), { objectStreams: false });
      await compare(() => make(n), { version: '1.4', objectStreams: false });
    }
  });

  it('同じ文書を 2 度書いても同じ (書き手は文書を変えない)', async () => {
    const pdf = await make(10, 2);
    const a = await writePdf(pdf);
    const b = await writePdf(pdf);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(await pdf.save()).equals(Buffer.from(a))).toBe(true);
  });
});

describe('先に書く口 (PdfWriter の release)', () => {
  /** 流れ 6 つ (番号の小さいほうから) と、間に辞書を挟む文書 */
  const make = async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage([100, 100]);
    const refs: PDFRef[] = [];
    for (let i = 0; i < 6; i++) {
      refs.push(pdf.context.register(pdf.context.flateStream(`q ${i} 0 0 ${i} 0 0 cm Q`.repeat(20), { N: i })));
      pdf.context.register(pdf.context.obj({ Between: i }));
    }
    return { pdf, refs };
  };

  it('番号の順の切れ目までを書いて文書から除き、出来た PDF は save と同じ (オブジェクトの流れ・相互参照の表・圧縮の関数)', async () => {
    for (const o of [{}, { objectStreams: false }, { deflate: (d: Uint8Array) => deflateSync(d, { level: 1 }) }] as PdfWriteOptions[]) {
      const ref = await (async () => {
        const { pdf } = await make();
        return legacySave(pdf, o);
      })();
      const { pdf, refs } = await make();
      const w = new PdfWriter(pdf, o);
      // 3 つ目を先に知らせても、1・2 つ目がまだなので待つ
      w.release(refs[2]);
      expect(w.early.length).toBe(0);
      expect(pdf.context.lookup(refs[2])).toBeDefined();
      w.release(refs[0]);
      w.release(refs[1]);
      if (o.objectStreams === false) {
        // 相互参照の表で書くときは、流れでないもの (先に作ったカタログ・ページの木・ページ) も番号の順に書くので、何も先に書かない
        expect(pdf.context.lookup(refs[0])).toBeDefined();
        expect(w.early.length).toBe(0);
      } else {
        // 1〜3 つ目を書いて除く (見出しと 3 つ)
        for (const r of refs.slice(0, 3)) expect(pdf.context.lookup(r)).toBeUndefined();
        expect(w.early.length).toBe(4);
      }
      w.release(refs[4]);
      expect(pdf.context.lookup(refs[4])).toBeDefined();
      const bytes = await w.finish();
      expect(Buffer.from(bytes).equals(Buffer.from(ref))).toBe(true);
    }
  });

  it('流れでないもの・2 度目・finish の後の release は誤り', async () => {
    const { pdf, refs } = await make();
    const w = new PdfWriter(pdf);
    expect(() => w.release(pdf.context.register(pdf.context.obj({ A: 1 })))).toThrow(/not a stream/);
    w.release(refs[0]);
    expect(() => w.release(refs[0])).toThrow(/twice/);
    await w.finish();
    expect(() => w.release(refs[1])).toThrow(/after finish/);
    await expect(w.finish()).rejects.toThrow(/twice/);
  });

  it('まだ中身の無い番号 (nextRef で取ったもの) より後ろは待たせる', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage([100, 100]);
    const later = pdf.context.nextRef();
    const s = pdf.context.register(pdf.context.stream('abc'));
    const w = new PdfWriter(pdf);
    w.release(s);
    expect(pdf.context.lookup(s)).toBeDefined();
    pdf.context.assign(later, pdf.context.stream('def'));
    w.release(later);
    expect(pdf.context.lookup(s)).toBeUndefined();
    expect(pdf.context.lookup(later)).toBeUndefined();
    const ref = await (async () => {
      const p = await PDFDocument.create({ updateMetadata: false });
      p.addPage([100, 100]);
      const l = p.context.nextRef();
      p.context.register(p.context.stream('abc'));
      p.context.assign(l, p.context.stream('def'));
      return p.save();
    })();
    expect(Buffer.from(await w.finish()).equals(Buffer.from(ref))).toBe(true);
  });
});

describe('まとめて先に書く口 (releaseAll・defer) と、書き出し先へ流す形', () => {
  /** 中身の無い番号 (書体の辞書の代わり)・流れ・辞書を交ぜた文書。後で中身の無い番号に辞書を入れる */
  const make = async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage([100, 100]);
    const later = pdf.context.nextRef();
    const refs: PDFRef[] = [];
    for (let i = 0; i < 4; i++) {
      refs.push(pdf.context.register(pdf.context.flateStream(`q ${i} Q`.repeat(9000 * (i + 1)), { N: i })));
      pdf.context.register(pdf.context.obj({ Between: i }));
    }
    return { pdf, later, refs };
  };
  const fill = (pdf: PDFDocument, later: PDFRef) => pdf.context.assign(later, pdf.context.obj({ Type: 'Font' }));

  it('中身の無い番号は最後に書くと決め、いまある流れを書く。流れでないものが後で入れば save と同じ', async () => {
    const want = await (async () => {
      const { pdf, later } = await make();
      fill(pdf, later);
      return legacySave(pdf, {});
    })();
    const { pdf, later, refs } = await make();
    const w = new PdfWriter(pdf);
    w.releaseAll();
    for (const r of refs) expect(pdf.context.lookup(r)).toBeUndefined();
    fill(pdf, later);
    expect(Buffer.from(await w.finish()).equals(Buffer.from(want))).toBe(true);
  });

  it('hold の流れは最後に書く (並びだけが違う)。defer した流れも', async () => {
    const { pdf, later, refs } = await make();
    const w = new PdfWriter(pdf);
    w.releaseAll(new Set([refs[1].objectNumber]));
    expect(pdf.context.lookup(refs[1])).toBeDefined();
    expect(pdf.context.lookup(refs[2])).toBeUndefined();
    fill(pdf, later);
    const bytes = await w.finish();
    const doc = await PDFDocument.load(bytes);
    for (const r of refs) expect(doc.context.lookup(r)).toBeDefined();
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.indexOf(`${refs[1].objectNumber} 0 obj`)).toBeGreaterThan(text.indexOf(`${refs[3].objectNumber} 0 obj`));
  });

  it('流した塊を繋ぐと、流さずに書いたものと同じ。塊は 64KB まで', async () => {
    const plain = await (async () => {
      const { pdf, later } = await make();
      const w = new PdfWriter(pdf);
      w.releaseAll();
      fill(pdf, later);
      return w.finish();
    })();
    const { pdf, later } = await make();
    const chunks: Uint8Array[] = [];
    const port = new PdfOutputPort((c) => void chunks.push(c));
    const w = new PdfWriter(pdf, {}, { output: port });
    w.releaseAll();
    expect(w.drain()).toBeUndefined();
    const early = chunks.length;
    expect(early).toBeGreaterThan(0);
    fill(pdf, later);
    await w.finish();
    await port.close();
    expect(Buffer.concat(chunks).equals(Buffer.from(plain))).toBe(true);
    expect(port.bytes).toBe(plain.length);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1 << 16);
  });
});

describe('壊れたオブジェクト (PDFInvalidObject) を含む文書', () => {
  /** 流れの前に、読めなかったオブジェクト (PDF の画像の写しに入りうる) を置いた文書 */
  const make = async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage([100, 100]);
    pdf.context.register(PDFInvalidObject.of(new TextEncoder().encode('@@ broken @@')));
    const refs: PDFRef[] = [];
    for (let i = 0; i < 4; i++) refs.push(pdf.context.register(pdf.context.flateStream(`q ${i} Q`.repeat(50), { N: i })));
    return { pdf, refs };
  };

  it('壊れたオブジェクトで止まらずに、後ろの流れを先に書く。出来た PDF は save と同じ', async () => {
    const want = await (async () => legacySave((await make()).pdf, {}))();
    const { pdf, refs } = await make();
    const w = new PdfWriter(pdf);
    w.releaseAll();
    for (const r of refs) expect(pdf.context.lookup(r)).toBeUndefined();
    expect(Buffer.from(await w.finish()).equals(Buffer.from(want))).toBe(true);
  });

  it('releaseAll は、前になめた所の続きからなめる (先に書けずに止まっている間も、ページごとに初めからなめ直さない)', async () => {
    const pdf = await PDFDocument.create({ updateMetadata: false });
    pdf.addPage([100, 100]);
    // 相互参照の表で書くときは、流れでないものも番号の順に書くので、先に書く所はカタログで止まったまま
    const w = new PdfWriter(pdf, { objectStreams: false });
    // なめた番号の数 (書いてよいと知らされた番号の表を引いた数) を数える
    const released = (w as unknown as { released: Set<number> }).released;
    const has = released.has.bind(released);
    let looked = 0;
    released.has = (n: number) => (looked++, has(n));
    for (let page = 0; page < 200; page++) {
      for (let i = 0; i < 5; i++) pdf.context.register(pdf.context.flateStream(`q ${i} Q`, { P: page, I: i }));
      w.releaseAll();
    }
    // 1 回ずつなめれば、番号の数 (1,000 ほど) の 2 倍ほど。初めからなめ直すと、その 100 倍ほど
    expect(looked).toBeLessThan(5000);
  });
});
