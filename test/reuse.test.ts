/**
 * 器 (createTypesetter) の、文書をまたぐ使い回し (reuse): 書体のファイルの下ごしらえ (fontManager.ts の FontPrepCache) と、
 * 段落の行分けの結果 (layoutEngine.ts の SharedLineMemo)。
 * 使い回しても組んだ結果が変わらないことを、使い回す器と使い回さない器 (reuse: false) で同じ文書の並び (少しずつ直したもの) を組み、
 * 警告・領域の木 (serializeAreaTree)・PDF のバイト列が同じことで確かめる。PDF の作った日時は時計を止めて、ファイルの識別子 (trailer の ID。
 * 乱数で作る) は乱数を止めて同じにする。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, KumioriOptionError, createTypesetter, serializeAreaTree, type FontSpec, type Typesetter } from '../src/index';
import { FontManager, FontPrepCache } from '../src/fontManager';
import { SharedLineMemo } from '../src/layoutEngine';
import { Measurer } from '../src/measurer';
import { EXTRA_TEST_FONTS, cachedFont, ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

let lobster: Uint8Array;
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
  lobster = new Uint8Array(fs.readFileSync(await cachedFont('Lobster-latin.woff2', EXTRA_TEST_FONTS['Lobster-latin.woff2'])));
}, 300_000);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SENTENCES = [
  '組版の器は、書体を一度だけ読み込み、文書を何度でも組む。',
  'The quick brown fox jumps over the lazy dog, and typesetting continues with internationalization.',
  '段落の行分けは、字の送りと改行の機会で決まる。「括弧」や、句読点。の詰めもある。',
  'Hyphenation splits extraordinarily long words such as incomprehensibilities at the line end.',
];

/** 見出し (目次からページ番号で引く)・脚注・ルビ・等幅・@font-face (WOFF2) の書体・縦書き・表を持つ HTML。edit 番目の段落に字を足す */
function htmlDoc(edit: number, extra = ''): string {
  const paras: string[] = [];
  for (let i = 0; i < 40; i++) {
    const t = SENTENCES[i % SENTENCES.length].repeat(1 + (i % 3));
    const add = i === edit ? `直した所${extra}。` : '';
    if (i % 10 === 0) paras.push(`<h2 id="s${i}">見出し ${i}</h2>`);
    if (i % 7 === 3) paras.push(`<p>${add}<ruby>漢字<rt>かんじ</rt></ruby>の段落。${t}<span class="fn">脚注 ${i}</span></p>`);
    else if (i % 7 === 4) paras.push(`<p lang="en" class="en">${add}${t} <code>mono ${i}</code> <span class="lob">Lobster ${i}</span></p>`);
    else if (i % 11 === 5) paras.push(`<div class="v"><p>${add}縦書きの段落。${t}</p></div>`);
    else if (i % 13 === 6) paras.push(`<table><tr><td>${add}表の欄</td><td>${t}</td></tr></table>`);
    else paras.push(`<p>${add}${t}</p>`);
  }
  const toc = [0, 10, 20, 30].map((i) => `<li><a href="#s${i}">見出し ${i}</a></li>`).join('');
  return `<!doctype html><html lang="ja"><head><style>
@font-face { font-family: Lob; src: url(Lobster-latin.woff2) format("woff2"); }
@page { size: A6; margin: 10mm; @bottom-center { content: counter(page) } }
h2 { break-before: page; font-size: 14pt }
.lob { font-family: Lob, serif }
.fn { float: footnote }
p.en { hyphens: auto; text-align: justify }
nav a::after { content: " … " target-counter(attr(href url), page) }
.v { writing-mode: vertical-rl; height: 50mm }
td { border: 1px solid black }
</style></head><body><nav><ol>${toc}</ol></nav>${paras.join('\n')}</body></html>`;
}

/** page-sequence を 2 つ持ち、ページ番号を引く XSL-FO。edit 番目の段落に字を足す */
function foDoc(edit: number): string {
  const blocks = (from: number) =>
    Array.from({ length: 20 }, (_, k) => {
      const i = from + k;
      return `<fo:block id="b${i}" space-after="4pt">${i === edit ? '直した所。' : ''}${SENTENCES[i % SENTENCES.length].repeat(2)}</fo:block>`;
    }).join('');
  const seq = (from: number, title: string) => `<fo:page-sequence master-reference="p"><fo:static-content flow-name="xsl-region-after"><fo:block text-align="center"><fo:page-number/></fo:block></fo:static-content>
<fo:flow flow-name="xsl-region-body"><fo:block font-size="14pt">${title}</fo:block><fo:block>参照: <fo:page-number-citation ref-id="b${from + 15}"/> ページ</fo:block>${blocks(from)}</fo:flow></fo:page-sequence>`;
  return `<?xml version="1.0" encoding="UTF-8"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xml:lang="ja">
<fo:layout-master-set><fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="10mm"><fo:region-body margin-bottom="8mm"/><fo:region-after extent="6mm"/></fo:simple-page-master></fo:layout-master-set>
${seq(0, '一つ目')}${seq(20, '二つ目')}</fo:root>`;
}

/** PDF の日時と識別子を、毎回同じにする (時計と乱数を止める) */
function fixClockAndRandom() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
    if (a) new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(7);
    return a;
  });
}

/** 文書を組み、比べるもの (警告・領域の木・PDF) を返す。PDF の日時と識別子は止めた値 */
async function snapshot(t: Typesetter, text: string, options: Parameters<Typesetter['typeset']>[1]) {
  const r = await t.typeset(text, options);
  const pdf = await r.toPdf();
  return { warnings: r.warnings.slice(), tree: serializeAreaTree(r.areaTree), pdf: Buffer.from(pdf).toString('base64'), pages: r.pageCount };
}

/** SharedLineMemo.get が結果を返した回数を数える */
function countSharedHits() {
  const get = SharedLineMemo.prototype.get;
  const n = { hits: 0 };
  vi.spyOn(SharedLineMemo.prototype, 'get').mockImplementation(function (this: SharedLineMemo, ...a: Parameters<SharedLineMemo['get']>) {
    const r = get.apply(this, a);
    if (r) n.hits++;
    return r;
  });
  return n;
}

describe('createTypesetter の reuse: 使い回しても、組んだ結果は使い回さないときと同じ', () => {
  beforeEach(() => fixClockAndRandom());
  it('HTML: 段落を直しながら組んだ領域の木・PDF・警告が、reuse: false の器と同じ。2 つ目の文書からは行分けの結果と書体の下ごしらえを使い回す', async () => {
    const files = () => [{ name: 'Lobster-latin.woff2', data: lobster.slice() }];
    const on = await createTypesetter({ loadFont });
    const off = await createTypesetter({ loadFont, reuse: false });
    const prep = vi.spyOn(FontPrepCache.prototype, 'get');
    const hits = countSharedHits();
    // 直す段落を変えながら組む (最後は、初めの文書に戻す)
    const versions = [htmlDoc(-1), htmlDoc(12), htmlDoc(12, 'もう少し長く、行の増えるように字を足した所'), htmlDoc(25), htmlDoc(-1)];
    const perDoc: number[] = [];
    for (const v of versions) {
      const before = hits.hits;
      const a = await snapshot(on, v, { kind: 'html', files: files() });
      perDoc.push(hits.hits - before);
      const b = await snapshot(off, v, { kind: 'html', files: files() });
      expect(a.pages).toBeGreaterThan(5);
      expect(a.warnings).toEqual(b.warnings);
      expect(a.tree).toBe(b.tree);
      expect(a.pdf).toBe(b.pdf);
    }
    // 2 つ目の文書から、@font-face の WOFF2 の下ごしらえを使い回す
    expect(prep.mock.results.some((r) => r.value !== undefined)).toBe(true);
    // 行分けの結果を使い回す (初めの文書の後で等幅の書体を器に足すので、書体の組の並びが同じになる 3 つ目の文書から)。
    // 初めの文書でも、同じ中身の段落 (繰り返しの文) には当たる
    expect(Math.min(...perDoc.slice(2))).toBeGreaterThan(perDoc[0] + 20);
  }, 300_000);

  it('XSL-FO: page-sequence とページ番号の参照のある文書を直しながら組んだ結果が、reuse: false の器と同じ', async () => {
    const on = await createTypesetter({ loadFont });
    const off = await createTypesetter({ loadFont, reuse: false });
    const hits = countSharedHits();
    const perDoc: number[] = [];
    for (const v of [foDoc(-1), foDoc(5), foDoc(30), foDoc(-1)]) {
      const before = hits.hits;
      const a = await snapshot(on, v, { kind: 'fo', compat: 'spec' });
      perDoc.push(hits.hits - before);
      const b = await snapshot(off, v, { kind: 'fo', compat: 'spec' });
      expect(a.warnings).toEqual(b.warnings);
      expect(a.tree).toBe(b.tree);
      expect(a.pdf).toBe(b.pdf);
    }
    expect(Math.min(...perDoc.slice(1))).toBeGreaterThan(perDoc[0] + 20);
  }, 300_000);

  it('typesetToPdf (メモリ節約の組版を含む) も、reuse: false の器と同じ PDF', async () => {
    const on = await createTypesetter({ loadFont });
    const off = await createTypesetter({ loadFont, reuse: false });
    fixClockAndRandom();
    for (const v of [htmlDoc(-1), htmlDoc(8), htmlDoc(8)]) {
      for (const lowMemory of [false, true]) {
        const files = () => [{ name: 'Lobster-latin.woff2', data: lobster.slice() }];
        const a = await on.typesetToPdf(v, { kind: 'html', files: files() }, { lowMemory });
        const b = await off.typesetToPdf(v, { kind: 'html', files: files() }, { lowMemory });
        expect(a.warnings).toEqual(b.warnings);
        expect(Buffer.from(a.pdf).equals(Buffer.from(b.pdf))).toBe(true);
      }
    }
  }, 300_000);

  it('reuse: false の器は、行分けの結果を使い回さない。reuse は真偽値だけ', async () => {
    const hits = countSharedHits();
    const off = await createTypesetter({ loadFont, reuse: false });
    for (const v of [foDoc(-1), foDoc(-1), foDoc(-1)]) await off.typeset(v, { kind: 'fo' });
    expect(hits.hits).toBe(0);
    const bad = await createTypesetter({ loadFont, reuse: 'yes' as unknown as boolean }).catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(KumioriOptionError);
    expect((bad as KumioriOptionError).option).toBe('reuse');
  }, 300_000);

  it('reuse は器を作るときの設定: 文書ごとの設定に書くと、使われず api/setup-option-ignored の警告が出る', async () => {
    const t = await createTypesetter({ loadFont });
    const r = await t.typeset(foDoc(-1), { kind: 'fo', reuse: false } as never);
    expect(r.diagnostics.filter((d) => d.code === 'api/setup-option-ignored').map((d) => d.args?.option)).toEqual(['reuse']);
    const p = await t.typesetToPdf(foDoc(-1), { kind: 'fo', reuse: false } as never);
    expect(p.diagnostics.filter((d) => d.code === 'api/setup-option-ignored').map((d) => d.args?.option)).toEqual(['reuse']);
  }, 300_000);

  it('組む間に書体の知らせ (整形の表の誤りなど) が出た段落は、文書をまたぐ覚えに入れない (次の文書でも組み直して、知らせを出す)', async () => {
    const t = await createTypesetter({ loadFont });
    // 字を測るたびに、書体の知らせが出たことにする
    for (const name of ['glyph', 'glyphs'] as const) {
      const f = Measurer.prototype[name] as (...a: unknown[]) => unknown;
      vi.spyOn(Measurer.prototype, name).mockImplementation(function (this: Measurer, ...a: unknown[]) {
        (this as unknown as { fonts: FontManager }).fonts.noticeCount++;
        return f.apply(this, a);
      } as never);
    }
    const set = vi.spyOn(SharedLineMemo.prototype, 'set');
    await t.typeset(foDoc(-1), { kind: 'fo' });
    expect(set).not.toHaveBeenCalled();
  }, 300_000);

  it('行分けの覚え: 上限を超えるものは覚えず (覚えたものは捨てない)、前の文書で使わなかったものは次の文書の初めに捨てる。書体の組の印が違えば当たらない', async () => {
    const fonts = (await import('../src/fontManager')).FontManager;
    const fm = new fonts();
    const memo = (n: number) => ({ atoms: Array.from({ length: n }, () => ({})), raws: [], pls: [], lms: [] }) as never;
    const c = new SharedLineMemo(100 + 32 * 3);
    // 1 つも覚えていないときは、上限より大きくても覚える
    c.set('big', 'env', undefined, memo(500));
    expect(c.size).toBe(1);
    // 同じ鍵の覚え直しは、前のものを除いた大きさで数える
    c.set('big', 'env', undefined, memo(50));
    expect(c.size).toBe(1);
    c.set('b', 'env', undefined, memo(50));
    expect(c.size).toBe(2);
    // 上限を超えるので、c は覚えず、a・b は捨てない (上限より大きな文書を頭から組み直しても、前の方の段落が当たる)
    c.set('c', 'env', undefined, memo(50));
    expect(c.size).toBe(2);
    expect(c.get('c', 'env', fm, undefined)).toBeUndefined();
    expect(c.get('big', 'env', fm, undefined)).toBeDefined();
    expect(c.get('b', 'env', fm, undefined)).toBeDefined();
    expect(c.get('big', 'other', fm, undefined)).toBeUndefined();
    // 次の文書で big だけを使うと、その次の文書の初めに b を捨て、空いた分に新しい段落を覚えられる
    c.startDocument();
    expect(c.get('big', 'env', fm, undefined)).toBeDefined();
    c.startDocument();
    expect(c.size).toBe(1);
    expect(c.get('b', 'env', fm, undefined)).toBeUndefined();
    c.set('c', 'env', undefined, memo(50));
    expect(c.get('c', 'env', fm, undefined)).toBeDefined();
    // 2 つの文書のあいだ使わなければ、みな捨てる
    c.startDocument();
    c.startDocument();
    expect(c.size).toBe(0);
  });

  it('行分けの覚え: 前の組版を止めてすぐ次を組む (止めた知らせが、次の文書の初めの後に遅れて来る) ときも、最後に組み終えた文書の段落を残す。前の文書の組版も捨てない', async () => {
    const fonts = (await import('../src/fontManager')).FontManager;
    const fm = new fonts();
    const memo = (n: number) => ({ atoms: Array.from({ length: n }, () => ({})), raws: [], pls: [], lms: [] }) as never;
    const c = new SharedLineMemo();
    // F: 段落 p を覚えて組み終える
    const f = c.startDocument();
    c.set('p', 'env', undefined, memo(5));
    c.finishDocument(f);
    const prev = {} as never;
    c.layout.prev = prev;
    // A・B・C を始めては止め、止めた知らせは次の文書の初めの後に来る (どの文書も p を組む前に止める)
    const a = c.startDocument();
    const b = c.startDocument();
    c.cancelDocument(a);
    const d = c.startDocument();
    c.cancelDocument(b);
    c.startDocument();
    c.cancelDocument(d);
    // p は、最後に組み終えた文書 (F) の段落なので残る (前は B の初めに捨てた)。前の文書の組版も、遅れて来た止めた知らせで捨てない
    expect(c.get('p', 'env', fm, undefined)).toBeDefined();
    expect(c.layout.prev).toBe(prev);
  });

  it('行分けの覚え: 上限に達した後に別の文書へ移ると (いまの文書で 1 つも当たらない)、前の文書の項目を古いものから捨てて覚える', async () => {
    const fonts = (await import('../src/fontManager')).FontManager;
    const fm = new fonts();
    const memo = (n: number) => ({ atoms: Array.from({ length: n }, () => ({})), raws: [], pls: [], lms: [] }) as never;
    const c = new SharedLineMemo(3 * (50 + 32));
    // 文書 1 (B): 上限まで覚える
    for (const k of ['b1', 'b2', 'b3', 'b4']) c.set(k, 'env', undefined, memo(50));
    expect(c.size).toBe(3);
    // 文書 2 (A): B の段落を 1 つも使わないので、B の古いものから捨てて A を覚える
    c.startDocument();
    c.set('a1', 'env', undefined, memo(50));
    c.set('a2', 'env', undefined, memo(50));
    expect(c.size).toBe(3);
    expect(c.get('b1', 'env', fm, undefined)).toBeUndefined();
    expect(c.get('b3', 'env', fm, undefined)).toBeDefined();
    // 文書 3 (A を直したもの): 文書 2 で覚えた段落が当たる。当たりがあるので、上限では捨てずに断る
    c.startDocument();
    expect(c.get('a1', 'env', fm, undefined)).toBeDefined();
    c.set('a3', 'env', undefined, memo(50));
    expect(c.get('a3', 'env', fm, undefined)).toBeUndefined();
    expect(c.get('a2', 'env', fm, undefined)).toBeDefined();
  });

  it('書体の下ごしらえの覚え: 同じ中身なら、別のバッファでも当たり、中身が 1 バイトでも違えば当たらない。2 つ前の文書から使わないものは捨てる', () => {
    const c = new FontPrepCache();
    const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const prepared = { buffer: new ArrayBuffer(4), repaired: [] };
    c.set(a.buffer, prepared);
    expect(c.get(a.slice().buffer)).toBe(prepared);
    const b = a.slice();
    b[6] = 9;
    expect(c.get(b.buffer)).toBeUndefined();
    // 覚えるときに写すので、渡したバッファを後で書き換えても、覚えは変わらない
    a[0] = 0;
    expect(c.get(new Uint8Array([1, 2, 3, 4, 5, 6, 7]).buffer)).toBe(prepared);
    c.startDocument();
    expect(c.get(new Uint8Array([1, 2, 3, 4, 5, 6, 7]).buffer)).toBe(prepared);
    c.startDocument();
    c.startDocument();
    expect(c.get(new Uint8Array([1, 2, 3, 4, 5, 6, 7]).buffer)).toBeUndefined();
  });

  it('書体の下ごしらえの覚え: 止めた文書 (maxPages・止める合図) だけを続けても、使わなくなった書体は捨て、最後に組み終えた文書の書体は残す', () => {
    const c = new FontPrepCache();
    const font = (n: number) => new Uint8Array([n, 1, 2, 3]).buffer;
    const prepared = { buffer: new ArrayBuffer(4), repaired: [] };
    // 組み終えた文書 F が書体 0 を使う
    c.finishDocument((c.startDocument(), c.set(font(0), prepared), 1));
    // 止めた文書を、別々の書体で 5 つ続ける
    for (let n = 1; n <= 5; n++) {
      const d = c.startDocument();
      c.set(font(n), prepared);
      c.cancelDocument(d);
    }
    // 前の文書 (5) と、最後に組み終えた文書 (F の 0) の書体だけが残る (前は 0〜5 のすべてが残った)
    c.startDocument();
    expect(c.size).toBe(2);
    expect(c.get(font(5))).toBe(prepared);
    expect(c.get(font(0))).toBe(prepared);
    expect(c.get(font(3))).toBeUndefined();
  });

  it('書体の下ごしらえの覚え: 最後に組み終えた文書の書体は、止めた文書で 1 度使った後、それを使わない止めた文書が続いても残す', () => {
    const c = new FontPrepCache();
    const F = new Uint8Array([7, 1, 2, 3]).buffer;
    const G = new Uint8Array([8, 1, 2, 3]).buffer;
    const prepared = { buffer: new ArrayBuffer(4), repaired: [] };
    // 1: 組み終える (F を使う)
    const d1 = c.startDocument();
    c.set(F, prepared);
    c.finishDocument(d1);
    // 2: 止めた文書で F を使う
    const d2 = c.startDocument();
    expect(c.get(F)).toBe(prepared);
    c.cancelDocument(d2);
    // 3: 止めた文書で G だけを使う
    const d3 = c.startDocument();
    c.set(G, prepared);
    c.cancelDocument(d3);
    // 4: F は、最後に組み終えた文書 (1) の書体なので残る (前は、2 で使った番号で上書きされて捨てられた)
    c.startDocument();
    expect(c.get(F)).toBe(prepared);
    expect(c.get(G)).toBe(prepared);
  });

  it('書体の下ごしらえの覚え: 前の組版を止めてすぐ次を組む (止めた知らせが、次の文書の初めの後に遅れて来る) ときも、最後に組み終えた文書の書体を残す', () => {
    const c = new FontPrepCache();
    const X = new Uint8Array([9, 1, 2, 3]).buffer;
    const Y = new Uint8Array([10, 1, 2, 3]).buffer;
    const prepared = { buffer: new ArrayBuffer(4), repaired: [] };
    // 1: 組み終える (X・Y を使う)
    const d1 = c.startDocument();
    c.set(X, prepared);
    c.set(Y, prepared);
    c.finishDocument(d1);
    // 2 (A): Y だけを使い、止める。止めた知らせは、次の文書 (B) の初めの後に来る
    const a = c.startDocument();
    expect(c.get(Y)).toBe(prepared);
    const b = c.startDocument();
    c.cancelDocument(a);
    // B の初めに X を捨てない (前は、止めた A を組み終えた文書と数えて、X を捨てた)
    expect(c.get(X)).toBe(prepared);
    // B を組み終えると、B が最後に組み終えた文書になる (前は、遅れて来た止めた印が B に付いた)
    c.finishDocument(b);
    c.startDocument();
    c.startDocument();
    expect(c.get(X)).toBe(prepared);
  });
});
