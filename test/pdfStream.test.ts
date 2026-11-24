/**
 * PDF を流して書く口 (typesetToPdfStream・Typesetter.typesetToPdfStream・TypesetResult.toPdfStream) の確かめ。
 *  - 中に印の付いた内容を持つ Form XObject の無い文書は、流した PDF が typesetToPdf と同じバイト列 (文書の ID も同じ)。
 *    PDF の機能を広く使う文書 (タグ付き PDF・PDF/UA-1・圧縮の関数・縦書き・SVG・PNG・JPEG・PDF の画像・リンク・しおり・フォームの欄・添付) で比べる
 *  - ある文書 (タグ付き PDF の、不透明度のある箱の中の字) は、番号ごとのオブジェクトが同じ (並びだけが違う)
 *  - 先に書いて除いた流れを、後で引かない (引いたら投げる試験用の切り替えで、全部の文書を通す)
 *  - 書き出し先の 3 つの形 (WritableStream・Promise を返す関数・値を返さない関数) と、メモリ節約の有り無しで、同じバイト列
 *  - 止める合図・書き出し先の誤り・PDF/X・PDF/A の誤り・書き出し先の形の誤り。背圧 (遅い書き出し先で、ページの間で待つ)
 *  - 足していく SHA-256 と、流すときの文書の ID
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib';
import { createTypesetter, DEFAULT_FONTS, typeset, typesetToPdf, typesetToPdfStream, type PdfOptions, type TypesetOptions, type TypesetPdfOptions } from '../src/index';
import { __setReleasedLookupCheckForTest } from '../src/pdfWriter';
import { createSha256, Sha256Js, sha256 } from '../src/sha256';
import { DocumentIdStream, DOCUMENT_ID_MARK } from '../src/pdfStandard';
import { KumioriOptionError } from '../src/errors';
import { encodeJpeg } from '../src/jpeg';
import { encodePng } from '../src/pixels';
import { makePdf, rawPdf } from './pdfImageFixtures';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);
beforeEach(() => __setReleasedLookupCheckForTest(true));
afterEach(() => __setReleasedLookupCheckForTest(false));

const DATE = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));
const uri = (mime: string, b: Uint8Array) => `data:${mime};base64,${Buffer.from(b).toString('base64')}`;
const cat = (parts: Uint8Array[]) => Buffer.concat(parts.map((p) => Buffer.from(p)));

/** 塊を集める書き出し先 (3 つの形) */
type Kind = 'sync' | 'async' | 'stream';
function collector(kind: Kind): { output: WritableStream<Uint8Array> | ((c: Uint8Array) => void | Promise<void>); parts: Uint8Array[]; state: { closed: boolean; aborted?: unknown } } {
  const parts: Uint8Array[] = [];
  const state: { closed: boolean; aborted?: unknown } = { closed: false };
  if (kind === 'sync') return { output: (c) => void parts.push(c), parts, state };
  if (kind === 'async') return { output: async (c) => void (await new Promise((r) => setTimeout(r, 0)), parts.push(c)), parts, state };
  const output = new WritableStream<Uint8Array>({
    write: async (c) => void (await new Promise((r) => setTimeout(r, 0)), parts.push(c)),
    close: () => void (state.closed = true),
    abort: (reason) => void (state.aborted = reason),
  });
  return { output, parts, state };
}

/** 流さずに組んだ PDF と、流して組んだ PDF */
async function both(text: string, name: string, pdf: TypesetPdfOptions = {}, files: { name: string; data: Uint8Array }[] = [], set: TypesetOptions = {}, kind: Kind = 'sync'): Promise<[Buffer, Buffer]> {
  const opts = { name, files, loadFont: loadCachedFont, ...set };
  const plain = (await typesetToPdf(text, opts, { date: DATE, ...pdf })).pdf;
  const c = collector(kind);
  const r = await typesetToPdfStream(text, opts, c.output, { date: DATE, ...pdf });
  const streamed = cat(c.parts);
  expect(r.bytes).toBe(streamed.length);
  if (kind === 'stream') expect(c.state.closed).toBe(true);
  return [Buffer.from(plain), streamed];
}

/** 番号ごとのオブジェクトの中身 (流れは辞書と、展開しないバイト列) */
async function objectsOf(bytes: Uint8Array): Promise<Map<number, string>> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = new Map<number, string>();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const s = obj instanceof PDFStream ? `${obj.dict.toString()}|${Buffer.from((obj as PDFRawStream).getContents()).toString('base64')}` : obj.toString();
    out.set(ref.objectNumber, s);
  }
  return out;
}

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
    '<!doctype html><html lang="ja"><head><title>流し書き</title><style>.v { writing-mode: vertical-rl; height: 6em } h2 { break-before: page }</style></head><body>' +
    '<h1 id="top">見出し</h1><p>本文 <b>太字</b> <a href="https://example.com/">外へ</a> <a href="#top">上へ</a></p>' +
    `<p><img src="${uri('image/png', alphaPng)}" alt="α"> <img src="${uri('image/png', rgbPng)}" alt="RGB"> <img src="${uri('image/jpeg', jpeg)}" alt="JPEG"> <img src="p.pdf" alt="PDF"></p>` +
    '<svg width="60" height="30" viewBox="0 0 60 30"><rect width="60" height="30" fill="#c00" opacity="0.5"/><text x="5" y="20">字</text></svg>' +
    '<div class="v">縦書きの段落。</div>' +
    Array.from({ length: 12 }, (_, i) => `<h2>節 ${i + 1}</h2><p>段落 ${i + 1}。<img src="${uri('image/png', i % 2 ? alphaPng : rgbPng)}" alt="図 ${i}"></p>`).join('') +
    '</body></html>';
});

describe('流した PDF は、typesetToPdf と同じバイト列', () => {
  const z9 = (d: Uint8Array) => deflateSync(d, { level: 9 });
  const cases: [string, PdfOptions, TypesetOptions][] = [
    ['ふつうの PDF (タグ付き)', {}, {}],
    ['タグを付けない PDF', {}, { tagged: false }],
    ['PDF/UA-1', {}, { pdfua: true }],
    ['圧縮の関数を渡した PDF', {}, { deflate: z9 }],
  ];
  for (const [name, o, set] of cases)
    it(`HTML: ${name}`, async () => {
      const [a, b] = await both(html, 's.html', o, files, set);
      expect(b.length).toBe(a.length);
      expect(b.equals(a)).toBe(true);
    });

  it('書き出し先の 3 つの形と、メモリ節約の有り無しで、同じバイト列', async () => {
    const [ref] = await both(html, 's.html', {}, files);
    for (const kind of ['sync', 'async', 'stream'] as Kind[])
      for (const lowMemory of [false, true]) {
        const [a, b] = await both(html, 's.html', lowMemory ? { lowMemory } : {}, files, {}, kind);
        expect(a.equals(ref)).toBe(true);
        expect(b.equals(ref)).toBe(true);
      }
  });

  it('止める合図・進み具合を渡しても同じ (ページの間で間をあける道)', async () => {
    const [ref] = await both(html, 's.html', {}, files);
    const [, b] = await both(html, 's.html', {}, files, { signal: new AbortController().signal, onProgress: () => {} }, 'stream');
    expect(b.equals(ref)).toBe(true);
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
      '<fo:block break-before="page">添付<fo:inline axf:annotation-type="FileAttachment" axf:annotation-file-attachment="url(note.txt)" axf:annotation-file-name="note.txt">a</fo:inline></fo:block>' +
      '</fo:flow></fo:page-sequence></fo:root>';
    const note = [{ name: 'note.txt', data: new TextEncoder().encode('添付の中身') }];
    const [a, b] = await both(fo, 's.fo', {}, note);
    expect(b.equals(a)).toBe(true);
  });

  it('組んだ結果の toPdfStream と、器の typesetToPdfStream', async () => {
    const opts = { name: 's.html', files, loadFont: loadCachedFont };
    const r = await typeset(html, opts);
    const plain = Buffer.from(await r.toPdf({ date: DATE }));
    const c = collector('stream');
    const { bytes } = await r.toPdfStream(c.output, { date: DATE });
    expect(bytes).toBe(plain.length);
    expect(cat(c.parts).equals(plain)).toBe(true);
    const t = await createTypesetter({ loadFont: loadCachedFont });
    const d = collector('async');
    const res = await t.typesetToPdfStream(html, { name: 's.html', files }, d.output, { date: DATE });
    expect(res.pageCount).toBe(r.pageCount);
    expect(cat(d.parts).equals(Buffer.from((await typesetToPdf(html, opts, { date: DATE })).pdf))).toBe(true);
  });

  it('先に書く: 最初の塊は、最後のページを描く前に書き出し先へ渡る', async () => {
    const events: string[] = [];
    let pages = 0;
    const output = (c: Uint8Array) => void events.push(`write ${pages} ${c.length}`);
    await typesetToPdfStream(html, { name: 's.html', files, loadFont: loadCachedFont, onProgress: (p) => p.phase === 'pdf' && (pages = p.pages ?? 0) }, output, { date: DATE });
    const first = Number(events[0].split(' ')[1]);
    expect(first).toBeLessThan(pages);
    // 64KB の塊に分けて渡す (最後の塊も)
    for (const e of events) expect(Number(e.split(' ')[2])).toBeLessThanOrEqual(1 << 16);
  });
});

describe('PDF の画像が壊れたオブジェクトを指す文書', () => {
  it('壊れたオブジェクト (PDFInvalidObject) で先に書く所が止まらない (最後のページの前に書き出し先へ渡る)。typesetToPdf と同じバイト列', async () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    // 資源の ExtGState が、読めないオブジェクト (5 番) を指す PDF
    const broken = rawPdf([[4, '<< >>', enc('0 0 1 rg 0 0 100 100 re f')], [5, '@@ ]] not an object']], '/Contents 4 0 R /Resources << /ExtGState << /G 5 0 R >> >>');
    const doc = `<!doctype html><html lang="ja"><body><p><img src="b.pdf" alt="壊れた PDF"></p>${Array.from({ length: 12 }, (_, i) => `<p style="break-before: page">${i}</p>`).join('')}</body></html>`;
    const files = [{ name: 'b.pdf', data: broken }];
    const opts = { name: 'b.html', files, loadFont: loadCachedFont };
    const plain = Buffer.from((await typesetToPdf(doc, opts, { date: DATE })).pdf);
    expect(plain.toString('latin1')).toContain('@@ ]] not an object');
    let pages = 0;
    const firstAt: number[] = [];
    const parts: Uint8Array[] = [];
    await typesetToPdfStream(doc, { ...opts, onProgress: (p) => p.phase === 'pdf' && (pages = p.pages ?? 0) }, (c) => void (firstAt.push(pages), parts.push(c)), { date: DATE });
    expect(firstAt[0]).toBeLessThan(13);
    expect(parts.length).toBeGreaterThan(1);
    expect(Buffer.concat(parts).equals(plain)).toBe(true);
  });
});

describe('中に印の付いた内容を持つ Form XObject のある文書は、同じオブジェクト', () => {
  it('タグ付き PDF の、不透明度のある箱の中の字', async () => {
    const doc = '<!doctype html><html lang="ja"><body><p>前</p><div style="opacity: 0.5"><p>半透明の字</p></div><p style="break-before: page">後</p><div style="opacity: 0.4">もう 1 つ</div><p style="break-before: page">終わり</p></body></html>';
    const [a, b] = await both(doc, 'o.html');
    // 並びが違う (相互参照の流れは、位置の数が違うので、圧縮した大きさも違いうる)
    expect(b.equals(a)).toBe(false);
    const [oa, ob] = await Promise.all([objectsOf(a), objectsOf(b)]);
    expect([...ob.keys()].sort((x, y) => x - y)).toEqual([...oa.keys()].sort((x, y) => x - y));
    for (const [n, v] of oa) if (!/^<<\n\/Type \/XRef/.test(v)) expect(ob.get(n)).toBe(v);
    // タグを付けなければ、同じバイト列
    const [c, d] = await both(doc, 'o.html', {}, [], { tagged: false });
    expect(d.equals(c)).toBe(true);
  });
});

describe('誤りと止める合図', () => {
  const opts = (): TypesetOptions => ({ name: 's.html', files, loadFont: loadCachedFont });

  it('PDF/X・PDF/A は、何も書く前に KumioriOptionError (WritableStream は理由で abort し、ロックを放す)', async () => {
    for (const pdf of [{ pdfx: { version: 'X-4' as const } }, { pdfa: { version: 'A-2b' as const } }]) {
      const c = collector('stream');
      const e = await typesetToPdfStream(html, opts(), c.output, pdf).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(KumioriOptionError);
      expect((e as KumioriOptionError).option).toBe(`pdf.${Object.keys(pdf)[0]}`);
      expect(c.parts.length).toBe(0);
      expect((c.output as WritableStream).locked).toBe(false);
    }
    const r = await typeset(html, opts());
    await expect(r.toPdfStream(() => {}, { pdfa: { version: 'A-2b' } })).rejects.toMatchObject({ option: 'pdfa' });
  });

  it('書き出し先の形の誤り', async () => {
    for (const bad of [undefined, null, 1, 'x', {}, { write() {} }])
      await expect(typesetToPdfStream(html, opts(), bad as never)).rejects.toMatchObject({ name: 'KumioriOptionError', option: 'output' });
    const ws = new WritableStream();
    const lock = ws.getWriter();
    await expect(typesetToPdfStream(html, opts(), ws)).rejects.toMatchObject({ option: 'output' });
    lock.releaseLock();
  });

  it('書き始める前の誤り (選択肢・前に止めた合図・書体の読み込み・PDF/X) でも、WritableStream を理由で abort する', async () => {
    const stopped = new AbortController();
    const reason = new Error('前に止めた');
    stopped.abort(reason);
    const boom = new Error('書体を読めない');
    const cases: [string, (out: WritableStream<Uint8Array>) => Promise<unknown>][] = [
      ['前に止めた合図', (out) => typesetToPdfStream(html, { ...opts(), signal: stopped.signal }, out)],
      ['書体の読み込みの誤り', (out) => typesetToPdfStream(html, { name: 's.html', loadFont: () => Promise.reject(boom) }, out)],
      ['PDF/X', (out) => typesetToPdfStream(html, opts(), out, { pdfx: { version: 'X-4' } })],
      ['選択肢の誤り', (out) => typesetToPdfStream(html, { ...opts(), maxPages: -3 }, out)],
      ['器の版の PDF/A', async (out) => (await createTypesetter({ loadFont: loadCachedFont })).typesetToPdfStream(html, {}, out, { pdfa: { version: 'A-2b' } })],
      ['toPdfStream の前に止めた合図', async (out) => (await typeset('<p>あ</p>', opts())).toPdfStream(out, { signal: stopped.signal })],
    ];
    for (const [name, run] of cases) {
      const c = collector('stream');
      const e = await run(c.output as WritableStream<Uint8Array>).then(
        () => undefined,
        (x: unknown) => x,
      );
      expect(e, name).toBeDefined();
      expect(c.state.aborted, name).toBe(e);
      expect(c.state.closed, name).toBe(false);
      expect((c.output as WritableStream).locked, name).toBe(false);
      expect(c.parts.length, name).toBe(0);
    }
  });

  it('pdfx: null・pdfa: null は、typesetToPdf と同じく PDF/X・PDF/A 無しとして通す', async () => {
    const [a, b] = await both('<p>あ</p>', 'n.html', { pdfx: null, pdfa: null } as never);
    expect(b.equals(a)).toBe(true);
    const r = await typeset('<p>あ</p>', opts());
    const c = collector('sync');
    await r.toPdfStream(c.output, { pdfx: null, pdfa: null } as never);
    expect(c.parts.length).toBeGreaterThan(0);
  });

  it('止める合図で止めたら、WritableStream を理由で abort し、理由で失敗する', async () => {
    const ac = new AbortController();
    const reason = new Error('やめた');
    const c = collector('stream');
    const p = typesetToPdfStream(html, { ...opts(), signal: ac.signal, onProgress: (q) => q.phase === 'pdf' && (q.pages ?? 0) >= 3 && ac.abort(reason) }, c.output, { date: DATE });
    await expect(p).rejects.toBe(reason);
    expect(c.state.aborted).toBe(reason);
    expect(c.state.closed).toBe(false);
    expect((c.output as WritableStream).locked).toBe(false);
  });

  it('書き出し先の誤りは、包まずにそのまま投げ、abort しない', async () => {
    const boom = new Error('書けない');
    let n = 0;
    await expect(
      typesetToPdfStream(html, opts(), () => {
        if (++n === 2) throw boom;
      }),
    ).rejects.toBe(boom);
    await expect(typesetToPdfStream(html, opts(), async () => Promise.reject(boom))).rejects.toBe(boom);
    let aborted = false;
    const ws = new WritableStream<Uint8Array>({
      write: () => Promise.reject(boom),
      abort: () => void (aborted = true),
    });
    await expect(typesetToPdfStream(html, opts(), ws)).rejects.toBe(boom);
    expect(aborted).toBe(false);
    expect(ws.locked).toBe(false);
  });

  it('背圧: 遅い WritableStream では、ページの間で待つ (書き出し先に並ぶ塊が増え続けない)', async () => {
    let queued = 0;
    let most = 0;
    const ws = new WritableStream<Uint8Array>(
      {
        write: async () => {
          await new Promise((r) => setTimeout(r, 5));
          queued--;
        },
      },
      { highWaterMark: 1 },
    );
    const w = ws as WritableStream<Uint8Array> & { getWriter(): WritableStreamDefaultWriter<Uint8Array> };
    const getWriter = w.getWriter.bind(w);
    w.getWriter = () => {
      const writer = getWriter();
      const write = writer.write.bind(writer);
      writer.write = (c?: Uint8Array) => {
        most = Math.max(most, ++queued);
        return write(c);
      };
      return writer;
    };
    await typesetToPdfStream(html, opts(), ws, { date: DATE });
    expect(most).toBe(1);
  });
});

describe('足していく SHA-256 と、流すときの文書の ID', () => {
  it('自前の計算と Node の crypto は、どう分けて足しても同じ', () => {
    const data = new Uint8Array(1000).map((_, i) => (i * 31 + 7) & 255);
    const want = createHash('sha256').update(data).digest('hex');
    for (const cuts of [[0], [1], [55, 56], [63, 64, 65], [128, 500, 999], [1000]]) {
      const js = new Sha256Js();
      const node = createSha256();
      let at = 0;
      for (const c of [...cuts, 1000]) {
        js.update(data.subarray(at, c));
        node.update(data.subarray(at, c));
        at = c;
      }
      expect(js.digest()).toBe(want);
      expect(node.digest()).toBe(want);
    }
    expect(new Sha256Js().update(new Uint8Array(0)).digest()).toBe(sha256(new Uint8Array(0)));
  });

  it('先の塊は中を探さずにハッシュに足すだけ (利用者のバイト列の中の印の字は数えない)', () => {
    const uuid = DOCUMENT_ID_MARK.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const id = new DocumentIdStream();
    expect(() => id.see(new TextEncoder().encode(`<?xpacket begin="" id="x"?><x>uuid:${uuid}<</x><?xpacket end="w"?> <${DOCUMENT_ID_MARK}>`))).not.toThrow();
  });

  it('流した PDF の ID は、印の値でない (書き換えた)', async () => {
    const parts: Uint8Array[] = [];
    await typesetToPdfStream('<p>あ</p>', { loadFont: loadCachedFont }, (c) => void parts.push(c), { date: DATE });
    const text = cat(parts).toString('latin1');
    expect(text).not.toContain(DOCUMENT_ID_MARK);
    expect(text).toMatch(/\/ID \[ <[0-9a-f]{32}> <[0-9a-f]{32}> \]/);
    // 読める PDF
    const doc = await PDFDocument.load(cat(parts));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.context.lookup(PDFRef.of(1))).toBeDefined();
  });
});
