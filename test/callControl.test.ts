/**
 * 止める合図 (signal) と進み具合 (onProgress) (src/callContext.ts・src/api.ts):
 *  - 止めた合図を渡すと、書体も文書も読まずに失敗する (どの入口でも)。理由を渡せば、その理由で失敗する
 *  - 資源の読み込みの途中で止めると、AbortError で失敗し、resolveResource・loadFont に渡した合図も止まる
 *  - 進み具合の段階の順。onProgress が投げた誤りは、そのまま返る
 *  - 止めた後も、器はそのまま使え、文書をまたぐ覚えの世代を進めない (止める前の文書の覚えが当たる)
 *  - 組版: ページを作るたびの進み具合 (回ごとに 1 から数え、最後の回はページ数まで)。ページの途中で止めても、器の覚えを壊さない
 *  - 回・page-sequence の境目で間をあけ、外からの abort が効く。渡さなければ間をあけない
 *  - PDF の書き出しの進み具合と止める合図
 *  - 渡しても渡さなくても、領域の木・PDF のバイト列・警告が同じ
 *  - 選択肢の検査
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FONTS, KumioriOptionError, createTypesetter, serializeAreaTree, typeset, typesetToPdf, type FontSpec, type ResourceContext, type TypesetOptions, type TypesetProgress } from '../src/index';
import { SharedLineMemo } from '../src/layoutEngine';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);
afterEach(() => vi.restoreAllMocks());

const html = '<!DOCTYPE html><html><head><link rel="stylesheet" href="a.css"></head><body><h1>見出し</h1><p>本文の段落です。止める合図を確かめます。</p><p><img src="a.png"></p></body></html>';

/** 失敗の理由を返す (成功したら undefined) */
async function reasonOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return undefined;
}

const isAbortError = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

describe('止める合図', () => {
  it('止めた合図を渡すと、何も読まずに失敗する (どの入口でも。理由を渡せばその理由)', async () => {
    const loadFont = vi.fn(loadCachedFont);
    const resolveResource = vi.fn(async () => undefined);
    const aborted = AbortSignal.abort();
    expect(isAbortError(await reasonOf(typeset(html, { name: 'a.html', loadFont, resolveResource, signal: aborted })))).toBe(true);
    expect(isAbortError(await reasonOf(typesetToPdf(html, { name: 'a.html', loadFont, resolveResource, signal: aborted })))).toBe(true);
    expect(isAbortError(await reasonOf(createTypesetter({ loadFont, signal: aborted })))).toBe(true);
    expect(loadFont).not.toHaveBeenCalled();
    const why = new Error('やめた');
    const ac = new AbortController();
    ac.abort(why);
    expect(await reasonOf(typeset(html, { name: 'a.html', loadFont, signal: ac.signal }))).toBe(why);
    expect(loadFont).not.toHaveBeenCalled();

    const t = await createTypesetter({ loadFont });
    const calls = loadFont.mock.calls.length;
    expect(isAbortError(await reasonOf(t.typeset(html, { name: 'a.html', resolveResource, signal: aborted })))).toBe(true);
    expect(isAbortError(await reasonOf(t.typesetToPdf(html, { name: 'a.html', resolveResource, signal: aborted })))).toBe(true);
    expect(resolveResource).not.toHaveBeenCalled();
    // 結果の toPdf・renderPageToSvg・renderPageToPng は、それぞれの設定の合図で止まる (組んだときの合図は引き継がない)
    const ac2 = new AbortController();
    const r = await t.typeset(html, { name: 'a.html', signal: ac2.signal });
    ac2.abort();
    expect((await r.toPdf()).length).toBeGreaterThan(0);
    expect(isAbortError(await reasonOf(r.toPdf({ signal: aborted })))).toBe(true);
    expect(isAbortError(await reasonOf(r.renderPageToSvg(0, { signal: aborted })))).toBe(true);
    expect(isAbortError(await reasonOf(r.renderPageToPng(0, { signal: aborted })))).toBe(true);
    expect(loadFont.mock.calls.length).toBe(calls);
  }, 120_000);

  it('資源の読み込みの途中で止めると AbortError で失敗し、resolveResource・loadFont に渡した合図も止まる', async () => {
    const ac = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const resolveResource = async (url: string, c?: ResourceContext) => {
      seen.push(c?.signal);
      if (/a\.css$/.test(url)) {
        // 読みかけのところで止める (利用者の取得は、渡した合図で止まる)
        ac.abort();
        expect(c?.signal?.aborted).toBe(true);
      }
      return undefined;
    };
    expect(isAbortError(await reasonOf(typeset(html, { name: 'a.html', loadFont: loadCachedFont, resolveResource, signal: ac.signal })))).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s instanceof AbortSignal)).toBe(true);

    // loadFont にも合図を渡す
    const fontSignals: Array<AbortSignal | undefined> = [];
    await createTypesetter({ loadFont: (spec: FontSpec, c?: ResourceContext) => (fontSignals.push(c?.signal), loadCachedFont(spec)) });
    expect(fontSignals.length).toBeGreaterThan(0);
    expect(fontSignals.every((s) => s instanceof AbortSignal)).toBe(true);
  }, 120_000);

  it('進み具合: 段階の順と、onProgress が投げた誤り', async () => {
    const got: TypesetProgress[] = [];
    await typeset(html, { name: 'a.html', loadFont: loadCachedFont, resolveResource: async () => undefined, onProgress: (p) => got.push(p) });
    const phases = [...new Set(got.map((p) => p.phase))];
    expect(phases.slice(0, 3)).toEqual(['fonts', 'resources', 'import']);
    const fonts = got.filter((p) => p.phase === 'fonts');
    expect(fonts.map((p) => p.loaded)).toEqual(fonts.map((_, k) => k + 1));
    expect(fonts.every((p) => p.total === fonts.length)).toBe(true);
    const oops = new Error('進み具合の誤り');
    expect(
      await reasonOf(
        typeset(html, {
          name: 'a.html',
          loadFont: loadCachedFont,
          onProgress: (p) => {
            if (p.phase === 'import') throw oops;
          },
        }),
      ),
    ).toBe(oops);
    // onProgress の中で止めれば、すぐ止まる
    const ac = new AbortController();
    expect(isAbortError(await reasonOf(typeset(html, { name: 'a.html', loadFont: loadCachedFont, signal: ac.signal, onProgress: (p) => p.phase === 'import' && ac.abort() })))).toBe(true);
  }, 120_000);

  it('並べて読む資源の 1 つで止めると、返す Promise が失敗した後に、残りの資源の読み込みが onProgress を呼ばない', async () => {
    const ac = new AbortController();
    const links = ['a', 'b', 'c', 'd'].map((n) => `<link rel="stylesheet" href="${n}.css">`).join('');
    let late = 0;
    let slow!: Promise<void>;
    const done = new Promise<void>((ok) => {
      slow = new Promise<void>((r) => setTimeout(r, 50)).then(ok);
    });
    const e = await reasonOf(
      typeset(`<!DOCTYPE html><html><head>${links}</head><body><p>本文</p></body></html>`, {
        name: 'a.html',
        loadFont: loadCachedFont,
        signal: ac.signal,
        resolveResource: async (url) => {
          if (url.endsWith('a.css')) {
            ac.abort();
            return 'p { color: red }';
          }
          await slow;
          return 'p { color: blue }';
        },
        onProgress: () => {
          if (ac.signal.aborted) late++;
        },
      }),
    );
    expect(isAbortError(e)).toBe(true);
    // 残りの資源が読み終えるのを待つ
    await done;
    await new Promise((r) => setTimeout(r, 10));
    expect(late).toBe(0);
  }, 60_000);

  it('止めた後も器はそのまま使え、文書をまたぐ覚えの世代を進めない', async () => {
    const t = await createTypesetter({ loadFont: loadCachedFont });
    const plain = await createTypesetter({ loadFont: loadCachedFont, reuse: false });
    const doc = (n: number) => `<!DOCTYPE html><html><body>${Array.from({ length: 12 }, (_, k) => `<p>段落 ${k} の本文です。行を分けるのに十分な長さの字を並べます。${'字'.repeat(40)}</p>`).join('')}<p>${n}</p></body></html>`;
    await t.typeset(doc(1), { name: 'a.html' });
    // 止める文書を 2 つ (資源の読み込みの途中で止める)
    for (let k = 0; k < 2; k++) {
      const ac = new AbortController();
      const r = await reasonOf(t.typeset(doc(2), { name: 'a.html', signal: ac.signal, onProgress: (p) => p.phase === 'import' && ac.abort() }));
      expect(isAbortError(r)).toBe(true);
    }
    // 止めた文書を世代に数えなければ、初めの文書の段落の覚えが当たる
    const get = SharedLineMemo.prototype.get;
    let hits = 0;
    vi.spyOn(SharedLineMemo.prototype, 'get').mockImplementation(function (this: SharedLineMemo, ...a: Parameters<SharedLineMemo['get']>) {
      const v = get.apply(this, a);
      if (v) hits++;
      return v;
    });
    const r = await t.typeset(doc(3), { name: 'a.html' });
    expect(hits).toBeGreaterThan(0);
    vi.restoreAllMocks();
    const fresh = await plain.typeset(doc(3), { name: 'a.html' });
    expect(serializeAreaTree(r.areaTree)).toBe(serializeAreaTree(fresh.areaTree));
    expect(r.warnings).toEqual(fresh.warnings);
  }, 120_000);

  it('選択肢の検査: signal は AbortSignal、onProgress は関数', async () => {
    const bad = async (p: Promise<unknown>, option: string) => {
      const e = await reasonOf(p);
      expect(e).toBeInstanceOf(KumioriOptionError);
      expect((e as KumioriOptionError).option).toBe(option);
    };
    await bad(typeset(html, { loadFont: loadCachedFont, signal: {} as never }), 'signal');
    await bad(typeset(html, { loadFont: loadCachedFont, onProgress: 1 as never }), 'onProgress');
    await bad(createTypesetter({ loadFont: loadCachedFont, signal: 'x' as never }), 'setup.signal');
    const r = await typeset(html, { loadFont: loadCachedFont });
    await bad(r.toPdf({ signal: {} as never }), 'signal');
    await bad(r.renderPageToSvg(0, { signal: 1 as never }), 'signal');
    // typesetToPdf の PDF の設定 (3 つ目の引数) の signal・onProgress は、黙って捨てずに選択肢の誤りにする (組む設定の側に渡す)
    const loadFont = vi.fn(loadCachedFont);
    await bad(typesetToPdf(html, { loadFont }, { signal: AbortSignal.abort() } as never), 'pdf.signal');
    await bad(typesetToPdf(html, { loadFont }, { onProgress: () => {} } as never), 'pdf.onProgress');
    const t = await createTypesetter({ loadFont: loadCachedFont });
    await bad(t.typesetToPdf(html, {}, { signal: new AbortController().signal } as never), 'pdf.signal');
    expect(loadFont).not.toHaveBeenCalled();
  }, 120_000);

  it('器で同時に組む呼び出しの片方を止めても、分け合う書体 (等幅) の読み込みは、ほかの呼び出しで成り立つ', async () => {
    // 等幅の書体だけ、門を開けるまで読み込みを待たせる。止める合図は loadFont に渡さない (分け合う読み込みは、どの呼び出しの合図にも結び付けない)
    let open!: () => void;
    const gate = new Promise<void>((ok) => (open = ok));
    let reached!: () => void;
    const waiting = new Promise<void>((ok) => (reached = ok));
    const monoSignals: Array<AbortSignal | undefined> = [];
    const t = await createTypesetter({
      loadFont: async (spec: FontSpec, c?: ResourceContext) => {
        if (spec.family === 'Cousine') {
          monoSignals.push(c?.signal);
          reached();
          await gate;
        }
        return loadCachedFont(spec);
      },
    });
    const doc = '<!DOCTYPE html><html><body><p>本文 <code>mono code</code></p></body></html>';
    const ac = new AbortController();
    const a = t.typeset(doc, { name: 'a.html', signal: ac.signal });
    const b = t.typeset(doc, { name: 'b.html' });
    await waiting;
    ac.abort();
    expect(isAbortError(await reasonOf(a))).toBe(true);
    open();
    const rb = await b;
    expect(rb.diagnostics.filter((d) => d.code === 'font/load-failed')).toEqual([]);
    // 止めた呼び出しの合図は、loadFont に渡していない (時限だけ)
    expect(monoSignals.every((sg) => !sg?.aborted)).toBe(true);
    const fresh = await (await createTypesetter({ loadFont: loadCachedFont, reuse: false })).typeset(doc, { name: 'b.html' });
    expect(serializeAreaTree(rb.areaTree)).toBe(serializeAreaTree(fresh.areaTree));
    // 止めた呼び出しは、止めた後の書体の読み込みの失敗を警告にせず、止めた理由で失敗する
    const ac2 = new AbortController();
    let open2!: () => void;
    const gate2 = new Promise<void>((ok) => (open2 = ok));
    const t2 = await createTypesetter({ loadFont: async (spec: FontSpec) => (spec.family === 'Cousine' ? (ac2.abort(), await gate2, undefined) : loadCachedFont(spec)) });
    const e2 = await reasonOf(t2.typeset(doc, { name: 'a.html', signal: ac2.signal }));
    open2();
    expect(isAbortError(e2)).toBe(true);
  }, 120_000);
});

// 何ページかになる HTML (目次のページ番号の参照で、組み直しの回が 2 回になる)
const longHtml = `<!DOCTYPE html><html><head><style>@page { size: A6 } a::after { content: target-counter(attr(href), page) }</style></head><body>` +
  `<p><a href="#s5">5 へ</a></p>` +
  Array.from({ length: 8 }, (_, k) => `<h2 id="s${k}">節 ${k}</h2>` + `<p>${'本文の字を並べて、ページを送ります。'.repeat(12)}</p>`).join('') +
  `</body></html>`;
// page-sequence の多い XSL-FO (境目ごとに間をあける)。force-page-count="even" の白ページと、最後のページのマスター (page-position="last") も
const fo = (n: number) =>
  `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set>` +
  `<fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="10mm"><fo:region-body/></fo:simple-page-master>` +
  `<fo:simple-page-master master-name="last" page-width="105mm" page-height="148mm" margin="20mm"><fo:region-body/></fo:simple-page-master>` +
  `<fo:page-sequence-master master-name="m"><fo:repeatable-page-master-alternatives>` +
  `<fo:conditional-page-master-reference master-reference="last" page-position="last"/><fo:conditional-page-master-reference master-reference="p"/>` +
  `</fo:repeatable-page-master-alternatives></fo:page-sequence-master></fo:layout-master-set>` +
  Array.from({ length: n }, (_, k) => `<fo:page-sequence master-reference="m" force-page-count="even"><fo:flow flow-name="xsl-region-body">` + `<fo:block>章 ${k} ${'字を並べます。'.repeat(80)}</fo:block></fo:flow></fo:page-sequence>`).join('') +
  `</fo:root>`;

describe('組版と PDF の、止める合図と進み具合', () => {
  it('ページを作るたびに知らせる: 回ごとに 1 から数え、最後の回はページ数まで', async () => {
    for (const [text, o] of [[longHtml, { name: 'a.html' }], [fo(3), { kind: 'fo' }]] as const) {
      const got: TypesetProgress[] = [];
      const r = await typeset(text, { ...o, loadFont: loadCachedFont, onProgress: (p) => got.push(p) } as TypesetOptions);
      const layout = got.filter((p) => p.phase === 'layout');
      expect(layout.length).toBeGreaterThan(0);
      expect(layout[0]).toEqual({ phase: 'layout', pass: 1, pages: 1 });
      const lastPass = Math.max(...layout.map((p) => p.pass!));
      const last = layout.filter((p) => p.pass === lastPass);
      expect(Math.max(...last.map((p) => p.pages!))).toBe(r.pageCount);
      expect(last[last.length - 1].pages).toBe(r.pageCount);
      // 段階の順: layout の後に、ほかの段階は来ない (toPdf は別の呼び出し)
      expect(got.slice(got.indexOf(layout[0])).every((p) => p.phase === 'layout')).toBe(true);
      if (text === longHtml) expect(lastPass).toBeGreaterThanOrEqual(2);
    }
  }, 120_000);

  it('ページの途中で止めても (onProgress の中で abort)、器はそのまま使え、新しい器と同じ結果になる', async () => {
    const t = await createTypesetter({ loadFont: loadCachedFont });
    const fresh = await (await createTypesetter({ loadFont: loadCachedFont, reuse: false })).typeset(longHtml, { name: 'a.html' });
    for (const k of [1, 3, 5]) {
      const ac = new AbortController();
      const e = await reasonOf(t.typeset(longHtml, { name: 'a.html', signal: ac.signal, onProgress: (p) => p.phase === 'layout' && p.pages === k && ac.abort() }));
      expect(isAbortError(e)).toBe(true);
      const r = await t.typeset(longHtml, { name: 'a.html' });
      expect(serializeAreaTree(r.areaTree)).toBe(serializeAreaTree(fresh.areaTree));
      expect(r.warnings).toEqual(fresh.warnings);
    }
  }, 120_000);

  it('page-sequence の境目で間をあけ、外からの abort が効く。渡さなければ間をあけない', async () => {
    const text = fo(12);
    const full = await typeset(text, { kind: 'fo', loadFont: loadCachedFont });
    // 初めのページを作ったときに、タイマーで abort を頼む (同期の組版の途中では効かず、次の境目で効く)
    const ac = new AbortController();
    let pages = 0;
    const e = await reasonOf(
      typeset(text, {
        kind: 'fo',
        loadFont: loadCachedFont,
        signal: ac.signal,
        onProgress: (p) => {
          if (p.phase !== 'layout') return;
          pages = Math.max(pages, p.pages!);
          if (p.pages === 1 && p.pass === 1) setTimeout(() => ac.abort(), 0);
        },
      }),
    );
    expect(isAbortError(e)).toBe(true);
    expect(pages).toBeLessThan(full.pageCount);
    // 渡さなければ、組版の間に setImmediate (間をあける手段) を呼ばない
    const spy = vi.spyOn(globalThis, 'setImmediate');
    await typeset(text, { kind: 'fo', loadFont: loadCachedFont });
    expect(spy).not.toHaveBeenCalled();
    await typeset(text, { kind: 'fo', loadFont: loadCachedFont, signal: new AbortController().signal });
    expect(spy).toHaveBeenCalled();
  }, 120_000);

  it('PDF の書き出し: ページごとの進み具合と止める合図 (toPdf・typesetToPdf・メモリ節約)', async () => {
    const r = await typeset(longHtml, { name: 'a.html', loadFont: loadCachedFont });
    const got: TypesetProgress[] = [];
    await r.toPdf({ onProgress: (p) => got.push(p) });
    expect(got).toEqual(Array.from({ length: r.pageCount }, (_, k) => ({ phase: 'pdf', pages: k + 1, total: r.pageCount })));
    const ac = new AbortController();
    expect(isAbortError(await reasonOf(r.toPdf({ signal: ac.signal, onProgress: (p) => p.pages === 2 && ac.abort() })))).toBe(true);
    // 止めた後も、同じ結果から PDF を作れる
    expect((await r.toPdf()).length).toBeGreaterThan(0);
    for (const lowMemory of [false, true]) {
      const seen: TypesetProgress[] = [];
      const p = await typesetToPdf(longHtml, { name: 'a.html', loadFont: loadCachedFont, onProgress: (x) => seen.push(x) }, { lowMemory });
      const pdf = seen.filter((x) => x.phase === 'pdf');
      expect(pdf.map((x) => x.pages)).toEqual(Array.from({ length: p.pageCount }, (_, k) => k + 1));
      expect(pdf.every((x) => x.total === p.pageCount)).toBe(true);
      // 組版の進み具合が先に来る
      expect(seen.findIndex((x) => x.phase === 'layout')).toBeLessThan(seen.findIndex((x) => x.phase === 'pdf'));
      const ac2 = new AbortController();
      const e = await reasonOf(typesetToPdf(longHtml, { name: 'a.html', loadFont: loadCachedFont, signal: ac2.signal, onProgress: (x) => x.phase === 'pdf' && x.pages === 1 && ac2.abort() }, { lowMemory }));
      expect(isAbortError(e)).toBe(true);
    }
  }, 120_000);

  it('signal・onProgress を渡しても渡さなくても、領域の木・PDF のバイト列・警告が同じ', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
      if (a) new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(7);
      return a;
    });
    try {
      for (const [text, o] of [[longHtml, { name: 'a.html' }], [fo(4), { kind: 'fo' }]] as const) {
        const variants: Array<Partial<TypesetOptions>> = [{}, { signal: new AbortController().signal }, { onProgress: () => {} }];
        const out = [];
        for (const v of variants) {
          const r = await typeset(text, { ...o, loadFont: loadCachedFont, ...v } as TypesetOptions);
          const pdf = Buffer.from(await r.toPdf()).toString('base64');
          const low = Buffer.from((await typesetToPdf(text, { ...o, loadFont: loadCachedFont, ...v } as TypesetOptions, { lowMemory: true })).pdf).toString('base64');
          out.push({ tree: serializeAreaTree(r.areaTree), pdf, low, warnings: r.warnings });
        }
        expect(out[1]).toEqual(out[0]);
        expect(out[2]).toEqual(out[0]);
      }
    } finally {
      vi.useRealTimers();
    }
  }, 180_000);
});
