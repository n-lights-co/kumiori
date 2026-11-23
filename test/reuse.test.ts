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

  it('行分けの覚え: 上限を超えたら古く使ったものから捨て、2 つ前の文書から使わないものも捨てる。書体の組の印が違えば当たらない', async () => {
    const fonts = (await import('../src/fontManager')).FontManager;
    const fm = new fonts();
    const memo = (n: number) => ({ atoms: Array.from({ length: n }, () => ({})), raws: [], pls: [], lms: [] }) as never;
    const c = new SharedLineMemo(100 + 32 * 3);
    c.set('a', 'env', undefined, memo(50));
    c.set('b', 'env', undefined, memo(50));
    expect(c.get('a', 'env', fm, undefined)).toBeDefined();
    // a を使ったので、上限を超えたときに捨てるのは b
    c.set('c', 'env', undefined, memo(50));
    expect(c.get('b', 'env', fm, undefined)).toBeUndefined();
    expect(c.get('a', 'env', fm, undefined)).toBeDefined();
    expect(c.get('a', 'other', fm, undefined)).toBeUndefined();
    c.startDocument();
    c.startDocument();
    expect(c.get('c', 'env', fm, undefined)).toBeUndefined();
    expect(c.size).toBe(0);
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
});
