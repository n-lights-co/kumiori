/**
 * 器 (createTypesetter) の、前の文書の page-sequence の使い回し (LayoutReuse・LayoutEngine.adoptPrev。design/resumable-flow.md の 6・16・17) の試験。
 * 使い回しても、使い回さない器と同じ結果 (領域の木・警告・診断・PDF) になること、前の文書の結果が変わらないこと、使い回してはいけない形では
 * 使い回さないことを確かめる。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, createTypesetter, serializeAreaTree, type FontSpec } from '../src/index';
import type { FontManager } from '../src/fontManager';
import { LayoutEngine } from '../src/layoutEngine';
import { Measurer } from '../src/measurer';
import { ensureFonts, fontDir } from './helpers';
import { checkRelayout, freezeClockAndRandom, type RelayoutRow } from '../scripts/relayout-check-lib.mjs';
import { encodePngStored } from '../src/pixels';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

// 前の文書から使い回した page-sequence の数 (adoptPrev が付け替えた数)
let adopted = 0;
const proto = LayoutEngine.prototype as unknown as { adoptPrev: (...a: unknown[]) => boolean };
const adoptPrev = proto.adoptPrev;
proto.adoptPrev = function (...a: unknown[]) {
  const r = adoptPrev.apply(this, a);
  if (r) adopted++;
  return r;
};
afterAll(() => {
  proto.adoptPrev = adoptPrev;
});
afterEach(() => {
  vi.restoreAllMocks();
});
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

const fo = (body: string, masters = '<fo:simple-page-master master-name="p" page-width="105mm" page-height="148mm" margin="10mm"><fo:region-body/></fo:simple-page-master>') =>
  `<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set>${masters}</fo:layout-master-set>${body}</fo:root>`;
const seq = (text: string, attrs = '') => `<fo:page-sequence master-reference="p"${attrs}><fo:flow flow-name="xsl-region-body">${text}</fo:flow></fo:page-sequence>`;
const paras = (k: number, n: number) => Array.from({ length: n }, (_, j) => `<fo:block>章 ${k} の段落 ${j}。${'字を並べて行を作る。'.repeat(4 + (j % 3))}</fo:block>`).join('');
const chapters = (edit: string) => fo([0, 1, 2].map((k) => seq(`<fo:block>章 ${k}${k === 1 ? edit : ''}</fo:block>${paras(k, 20)}`)).join(''));

/** 結果の比べる形 (領域の木・警告・診断・PDF) */
const shape = async (r: Awaited<ReturnType<Awaited<ReturnType<typeof createTypesetter>>['typeset']>>) => ({
  tree: serializeAreaTree(r.areaTree),
  warnings: r.warnings,
  diagnostics: JSON.stringify(r.diagnostics),
  // 日時を決める (書き出す時刻が秒をまたぐと、作成日の分だけ違う)
  pdf: Buffer.from(await r.toPdf({ date: new Date(0) })).toString('base64'),
});

describe('page-sequence の使い回し', () => {
  it('直していない page-sequence は使い回し、結果は使い回さない器と同じ。前の文書の結果も変わらない (typesetToPdf の道も同じ)', async () => {
    const restore = freezeClockAndRandom();
    try {
      const t = await createTypesetter({ loadFont });
      const ref = await createTypesetter({ loadFont, reuse: false });
      const r1 = await t.typeset(chapters(''), { kind: 'fo' });
      const before = await shape(r1);
      const a0 = adopted;
      const r2 = await t.typeset(chapters('。直した'), { kind: 'fo' });
      expect(adopted - a0, '使い回した page-sequence').toBeGreaterThan(0);
      expect(await shape(r2)).toEqual(await shape(await ref.typeset(chapters('。直した'), { kind: 'fo' })));
      expect(await shape(r1), '前の文書の結果').toEqual(before);
      // typesetToPdf も、前に typeset で覚えたページを使い回す (覚えはしない)
      const a1 = adopted;
      const p = await t.typesetToPdf(chapters('。また直した'), { kind: 'fo' }, { date: new Date(0) });
      const q = await ref.typesetToPdf(chapters('。また直した'), { kind: 'fo' }, { date: new Date(0) });
      expect(adopted - a1, 'typesetToPdf で使い回した page-sequence').toBeGreaterThan(0);
      expect(Buffer.from(p.pdf).equals(Buffer.from(q.pdf))).toBe(true);
      expect(JSON.stringify(p.diagnostics)).toBe(JSON.stringify(q.diagnostics));
    } finally {
      restore();
    }
  }, 300_000);

  it('警告の文は、いまの文書の言語で出す (言語の違う文書では使い回さない)', async () => {
    const doc = chapters('').replace('<fo:block>章 2', '<fo:block font-size="400pt">字</fo:block><fo:block>章 2');
    const t = await createTypesetter({ loadFont });
    await t.typeset(doc, { kind: 'fo', lang: 'ja' });
    const r = await t.typeset(doc, { kind: 'fo', lang: 'en' });
    const f = await (await createTypesetter({ loadFont, reuse: false })).typeset(doc, { kind: 'fo', lang: 'en' });
    expect(f.warnings.length).toBeGreaterThan(0);
    expect(r.warnings).toEqual(f.warnings);
  }, 300_000);

  it('force-page-count="auto" の page-sequence は、次の page-sequence の initial-page-number が変われば使い回さない (白ページの数が変わる)', async () => {
    const doc = (ipn: number) => fo(seq(paras(0, 2), ' force-page-count="auto"') + seq(paras(1, 2), ` initial-page-number="${ipn}"`));
    const t = await createTypesetter({ loadFont });
    await t.typeset(doc(2), { kind: 'fo' });
    const r = await t.typeset(doc(3), { kind: 'fo' });
    const f = await (await createTypesetter({ loadFont, reuse: false })).typeset(doc(3), { kind: 'fo' });
    expect(r.pageCount).toBe(f.pageCount);
    expect(serializeAreaTree(r.areaTree)).toBe(serializeAreaTree(f.areaTree));
  }, 300_000);

  it('使い回した page-sequence で当たった上限 (limit/reached) も、診断に出す', async () => {
    const doc = chapters('').replace('<fo:block>章 0', '<fo:block>点線<fo:leader leader-pattern="dots" leader-length="80mm"/>終わり</fo:block><fo:block>章 0');
    const t = await createTypesetter({ loadFont });
    const opts = { kind: 'fo' as const, limits: { leaderRepeats: 3 } };
    await t.typeset(doc, opts);
    const a0 = adopted;
    const r = await t.typeset(doc.replace('章 1', '章 1 を直した'), opts);
    const f = await (await createTypesetter({ loadFont, reuse: false })).typeset(doc.replace('章 1', '章 1 を直した'), opts);
    expect(adopted - a0).toBeGreaterThan(0);
    expect(f.diagnostics.some((d) => d.code === 'limit/reached')).toBe(true);
    expect(JSON.stringify(r.diagnostics)).toBe(JSON.stringify(f.diagnostics));
  }, 300_000);

  it('組む間に書体の知らせが出た page-sequence は使い回さない (知らせが抜けるので)', async () => {
    const t = await createTypesetter({ loadFont });
    // 字を測るたびに、書体の知らせが出たことにする
    for (const name of ['glyph', 'glyphs'] as const) {
      const f = Measurer.prototype[name] as (...a: unknown[]) => unknown;
      vi.spyOn(Measurer.prototype, name).mockImplementation(function (this: Measurer, ...a: unknown[]) {
        (this as unknown as { fonts: FontManager }).fonts.noticeCount++;
        return f.apply(this, a);
      } as never);
    }
    await t.typeset(chapters(''), { kind: 'fo' });
    const a0 = adopted;
    await t.typeset(chapters('。直した'), { kind: 'fo' });
    expect(adopted - a0).toBe(0);
  }, 300_000);

  it('次の段落の keep-with-previous を先に見て決めたページは、直した所より前のページとして使わない (前を飛ばす境目の読んだ先)', async () => {
    const doc = (kwp: number) => fo(seq(Array.from({ length: 30 }, (_, j) => `<fo:block${j === kwp ? ' keep-with-previous="always"' : ''}>段落 ${j}。${'字を並べて行を作る。'.repeat(5 + (j % 4))}</fo:block>`).join('')));
    const lib = { createTypesetter: (s: object) => createTypesetter({ loadFont, ...s }), serializeAreaTree } as never;
    for (const k of [5, 12]) {
      const r = await checkRelayout({ lib, options: { kind: 'fo' }, versions: [{ label: '元の文書', text: doc(-1) }, { label: `段落 ${k} に keep-with-previous`, text: doc(k) }, { label: '元に戻す', text: doc(-1) }], pdf: false });
      const bad = (r.versions as RelayoutRow[]).flatMap((v) => v.subjects.filter((x) => x.diff).map((x) => `${v.label}: ${JSON.stringify(x.diff)}`));
      expect(bad, `段落 ${k}`).toEqual([]);
    }
  }, 300_000);

  it('画素の数が同じで解像度 (dpi) の違う画像に差し替えたら、前の文書のページを使わない', async () => {
    // 100 × 100 画素の PNG に、pHYs (解像度) を入れる
    const crc = (b: Uint8Array) => {
      let c = ~0;
      for (const x of b) {
        c ^= x;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
      return ~c >>> 0;
    };
    const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const png = (dpi: number) => {
      const px = new Uint8Array(100 * 100 * 4).fill(200);
      const b = encodePngStored({ width: 100, height: 100, rgba: px } as never);
      const ppm = Math.round(dpi / 0.0254);
      const body = new Uint8Array([...'pHYs'].map((c) => c.charCodeAt(0)).concat(be32(ppm), be32(ppm), [1]));
      const chunk = new Uint8Array([...be32(9), ...body, ...be32(crc(body))]);
      return new Uint8Array([...b.subarray(0, 33), ...chunk, ...b.subarray(33)]);
    };
    const doc = fo(seq(`<fo:block><fo:external-graphic src="a.png"/></fo:block>${paras(0, 3)}`) + seq(paras(1, 3)));
    const t = await createTypesetter({ loadFont });
    await t.typeset(doc, { kind: 'fo', files: [{ name: 'a.png', data: png(72) }] });
    const r = await t.typeset(doc, { kind: 'fo', files: [{ name: 'a.png', data: png(300) }] });
    const f = await (await createTypesetter({ loadFont, reuse: false })).typeset(doc, { kind: 'fo', files: [{ name: 'a.png', data: png(300) }] });
    expect(serializeAreaTree(r.areaTree)).toBe(serializeAreaTree(f.areaTree));
  }, 300_000);

  it('同じ id が文書に 2 度あるとき、前の文書から使い回した page-sequence が、id の最初のページを書き換えない', async () => {
    // id x を、章 2 と、版によっては章 0 の終わりのブロックにも付ける (ブロックの数は変えない)。章 0 の参照と、章 1 からのリンクが、x の最初のページを指す
    const doc = (twice: boolean) =>
      fo(
        seq(`<fo:block>章 0 の参照 <fo:page-number-citation ref-id="x"/></fo:block>${paras(0, 12)}<fo:block${twice ? ' id="x"' : ''}>章 0 の x</fo:block>`) +
          seq(`<fo:block><fo:basic-link internal-destination="x">x へ</fo:basic-link></fo:block>${paras(1, 12)}`) +
          seq(`${paras(2, 12)}<fo:block id="x">章 2 の x</fo:block>`),
      );
    for (const [a, b] of [
      [false, true],
      [true, false],
    ]) {
      const t = await createTypesetter({ loadFont });
      await t.typeset(doc(a), { kind: 'fo' });
      const a0 = adopted;
      const r = await t.typeset(doc(b), { kind: 'fo' });
      // 章 1・2 は前の文書から使い回せる (章 0 だけ、id の属性が違う)
      if (!a) expect(adopted - a0, '使い回した page-sequence').toBeGreaterThan(0);
      const f = await (await createTypesetter({ loadFont, reuse: false })).typeset(doc(b), { kind: 'fo' });
      expect(await shape(r), `${a ? '2 度' : '1 度'} → ${b ? '2 度' : '1 度'}`).toEqual(await shape(f));
    }
  }, 300_000);

  it('同じ id の 2 度目が、前の page-sequence の 1 度目と同じページ番号にあっても、使い回した page-sequence が id の最後のページを書く', async () => {
    // 章 A の終わりと、initial-page-number="1" の章 B の 1 ページ目に id x を付ける (版 1 では、どちらも 1 ページ目)。
    // 版 2 で章 A の字を足すと、章 A の x は後ろのページへ動く。章 C の page-number-citation-last は、章 B の x のページ (1) を指す
    const doc = (long: boolean) =>
      fo(
        seq(`<fo:block>章 0 ${long ? '字を足して章を長くする。'.repeat(400) : ''}</fo:block><fo:block id="x">章 0 の x</fo:block>`) +
          seq(`<fo:block id="x">章 1 の x</fo:block>${paras(1, 3)}`, ' initial-page-number="1"') +
          seq(`<fo:block>x の最後のページ <fo:page-number-citation-last ref-id="x"/></fo:block>`),
      );
    const t = await createTypesetter({ loadFont });
    await t.typeset(doc(false), { kind: 'fo' });
    const a0 = adopted;
    const r = await t.typeset(doc(true), { kind: 'fo' });
    expect(adopted - a0, '使い回した page-sequence').toBeGreaterThan(0);
    const f = await (await createTypesetter({ loadFont, reuse: false })).typeset(doc(true), { kind: 'fo' });
    expect(await shape(r)).toEqual(await shape(f));
  }, 300_000);

  it('左右で本文の幅の違うページをまたぐ長い段落の後ろを続けて直しても、初めから組んだものと同じ (続けた流れが写した境目)', async () => {
    // 1 度目の直しは、長い段落の途中の境目から続けて組み、その流れが写した境目を器が覚える。2 度目の直しは、その境目から続ける
    const s = 'あいうえおかきくけこ。';
    const doc = (mid: string, tail: string) =>
      `<!doctype html><html lang="ja"><head><title>t</title><style>@page { size: A6; margin: 10mm } @page :left { margin-left: 20mm }</style></head><body><p>${s.repeat(500)}</p><p>B ${s.repeat(20)}${mid}${s.repeat(20)}${tail}</p><p>${s.repeat(100)}</p></body></html>`;
    const t = await createTypesetter({ loadFont });
    const fresh = await createTypesetter({ loadFont, reuse: false });
    for (const [mid, tail] of [
      ['', ''],
      ['', 'ん'],
      ['んん', 'ん'],
      ['んんん', 'んん'],
    ]) {
      const r = await t.typeset(doc(mid, tail), { kind: 'html' });
      const f = await fresh.typeset(doc(mid, tail), { kind: 'html' });
      expect(r.pageCount, `${mid}・${tail}`).toBe(f.pageCount);
      expect(serializeAreaTree(r.areaTree) === serializeAreaTree(f.areaTree), `${mid}・${tail}`).toBe(true);
    }
  }, 300_000);

  it('SVG の大きさと参照するファイルを変えずに、中身 (参照の仕方) を替えたら、前の文書のページを使わない', async () => {
    const svg = (inner: string) =>
      new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="50" viewBox="0 0 100 50">${inner}</svg>`);
    const png = encodePngStored({ width: 4, height: 4, rgba: new Uint8Array(64).fill(128) } as never);
    const doc = fo(seq(`<fo:block><fo:external-graphic src="a.svg"/></fo:block>${paras(0, 3)}`) + seq(paras(1, 3)));
    const files = (inner: string) => [
      { name: 'a.svg', data: svg(inner) },
      { name: 'b.png', data: png },
    ];
    const v1 = '<image href="b.png" width="10" height="10"/>';
    const v2 = '<use href="b.png#x"/>';
    const t = await createTypesetter({ loadFont });
    await t.typeset(doc, { kind: 'fo', files: files(v1) });
    const r = await t.typeset(doc, { kind: 'fo', files: files(v2) });
    const f = await (await createTypesetter({ loadFont, reuse: false })).typeset(doc, { kind: 'fo', files: files(v2) });
    expect(JSON.stringify(r.diagnostics)).toBe(JSON.stringify(f.diagnostics));
    expect(serializeAreaTree(r.areaTree)).toBe(serializeAreaTree(f.areaTree));
  }, 300_000);

  it('効果のある文書と無い文書を、同じ器で同時に組んでも、効果の印が混ざらない', async () => {
    const a = `<!DOCTYPE html><html><body>${Array.from({ length: 40 }, (_, k) => `<p>段落 ${k} <span style="opacity: 0.5; background: #fc0">効果のある字</span>。${'字を並べる。'.repeat(8)}</p>`).join('')}</body></html>`;
    const b = `<!DOCTYPE html><html><body>${Array.from({ length: 40 }, (_, k) => `<p>段落 ${k}。${'字を並べる。'.repeat(8)}</p>`).join('')}</body></html>`;
    const alone = await (await createTypesetter({ loadFont })).typeset(a, { kind: 'html' });
    const t = await createTypesetter({ loadFont });
    const [ra] = await Promise.all([t.typeset(a, { kind: 'html', onProgress: () => {} }), t.typeset(b, { kind: 'html', onProgress: () => {} })]);
    expect(serializeAreaTree(ra.areaTree)).toBe(serializeAreaTree(alone.areaTree));
  }, 300_000);
});
