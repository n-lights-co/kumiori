/**
 * 文書を作らずに文字列を測る API (Typesetter.measureText・breakLines。src/textMeasure.ts)。
 *  - 測った行 (行分け・行の文字・行の長さ・行の高さ) が、同じ文字列・同じスタイルを文書の中で組んだ行と同じこと (長さは 1/1000 pt 以内。
 *    文書の中の長さは単位の変換で 1/10000 pt ほど違うことがある)
 *    (和文の禁則・ぶら下げ、欧文のハイフネーション、字間、縦書き、太字・ゴシック、改行を残す指定、字下げ)
 *  - measureText は 1 行で組んだ長さ (文書の中で text-align: start・nowrap の行と同じ)
 *  - 測っても、Typesetter の再利用 (前の文書のページの使い回し) のキャッシュを変えないこと
 *  - 選択肢のエラー
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FONTS, createTypesetter, KumioriOptionError, type TextStyle, type Typesetter } from '../src/index';
import { LayoutEngine } from '../src/layoutEngine';
import { measuredLines } from '../src/textMeasure';
import { ensureFonts, loadCachedFont } from './helpers';

let t: Typesetter;
beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base]);
  t = await createTypesetter({ loadFont: loadCachedFont });
}, 300_000);

const cssOf = (style: TextStyle) =>
  Object.entries(style)
    .filter(([k]) => k !== 'lang' && k !== 'writingMode')
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${typeof v === 'number' && !['lineHeight', 'fontWeight'].includes(k) ? `${v}pt` : v}`)
    .join('; ');

/**
 * 同じ文字列・同じスタイルを、ふつうの文書 (A4・余白あり・見出しの後の div。幅を width にしたもの) の中で組んだ行
 * (その div の行だけを、測る API と同じ読み方で読む)
 */
async function inDocument(text: string, style: TextStyle, width: number) {
  const vertical = style.writingMode?.startsWith('vertical') ?? false;
  const box = vertical ? `height: ${width}pt` : `width: ${width}pt`;
  const html = `<!DOCTYPE html><html${style.lang ? ` lang="${style.lang}"` : ''} style="${style.writingMode ? `writing-mode: ${style.writingMode}` : ''}"><head><style>@page { size: A4; margin: 20mm }</style></head><body><h1>見出し</h1><div id="m" style="${box}; text-indent: 0; ${cssOf(style)}">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div><p>後ろの段落。</p></body></html>`;
  const r = await t.typeset(html, { tagged: false });
  // 文書の div (sourceRef で選ぶのは難しいので、見出しの後・段落の前の行を、div の中の文字で選ぶ)
  const all = measuredLines(r.areaTree.sheets, vertical, width).lines;
  const first = all.findIndex((l) => l.text === '見出し');
  const last = all.findIndex((l) => l.text === '後ろの段落。');
  return all.slice(first + 1, last);
}

const CASES: Array<[string, string, TextStyle, number]> = [
  ['和文 (禁則・ぶら下げ・両端揃え)', '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。', { fontSize: 11 }, 150],
  ['欧文 (ハイフネーション)', 'The quick brown fox jumps over the extraordinarily lazy dog, notwithstanding considerable typographical difficulties.', { lang: 'en', hyphens: 'auto', fontSize: '10pt' }, 130],
  ['字間・行の高さ・左揃え・ゴシックの太字', 'Kumiori の組版で、字間を空けて組む見出しの例です。', { fontFamily: 'sans-serif', fontWeight: 700, letterSpacing: 1, lineHeight: 1.4, textAlign: 'start', fontSize: 14 }, 160],
  ['縦書き', '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。', { writingMode: 'vertical-rl', fontSize: 12 }, 100],
  ['改行を残す指定と字下げ', '一行目の文。\n二行目はもう少し長い文で、行の長さを超えて折り返す。', { whiteSpace: 'pre-wrap', textIndent: '1em' }, 120],
];

describe('breakLines: 文書の中で組んだ行と同じ', () => {
  for (const [name, text, style, width] of CASES)
    it(name, async () => {
      const m = await t.breakLines(text, style, width);
      const want = await inDocument(text, style, width);
      expect(want.length).toBeGreaterThan(1);
      expect(m.lines.map((l) => l.text)).toEqual(want.map((l) => l.text));
      m.lines.forEach((l, i) => {
        expect(l.inlineSize).toBeCloseTo(want[i].inlineSize, 3);
        expect(l.blockSize).toBeCloseTo(want[i].blockSize, 3);
      });
      expect(m.lineCount).toBe(want.length);
      expect(m.blockSize).toBeCloseTo(want.reduce((n, l) => n + l.blockSize, 0), 3);
      expect(m.inlineSize).toBeCloseTo(Math.max(...want.map((l) => l.inlineSize)), 3);
      const vertical = style.writingMode === 'vertical-rl';
      expect([m.width, m.height]).toEqual(vertical ? [m.blockSize, m.inlineSize] : [m.inlineSize, m.blockSize]);
    });

  it('分けられない長い語は行の長さを超え、overflow が true', async () => {
    const m = await t.breakLines('Supercalifragilisticexpialidocious', { lang: 'en' }, 40);
    expect(m.lineCount).toBe(1);
    expect(m.overflow).toBe(true);
    expect(m.inlineSize).toBeGreaterThan(40);
  });
});

describe('measureText: 1 行で組んだ長さ', () => {
  it('文書の中で、text-align: start・white-space: nowrap に組んだ行と同じ長さ (行の長さに関わらない)', async () => {
    const text = '見出しの長さを測る Typesetter.measureText の例';
    const style: TextStyle = { fontSize: 18, fontWeight: 'bold', fontFamily: 'sans-serif' };
    const m = await t.measureText(text, style);
    expect(m.lineCount).toBe(1);
    expect(m.overflow).toBe(false);
    const want = await inDocument(text, { ...style, whiteSpace: 'nowrap', textAlign: 'start' }, 100);
    expect(want.length).toBe(1);
    expect(m.inlineSize).toBeCloseTo(want[0].inlineSize, 3);
    expect(m.lines[0].text).toBe(want[0].text);
    // 長さで分けたとき、1 行に収まる長さなら同じ長さ (両端揃えの最後の行は左揃え)
    const b = await t.breakLines(text, style, m.inlineSize + 1);
    expect(b.lineCount).toBe(1);
    expect(b.inlineSize).toBeCloseTo(m.inlineSize, 6);
    // 字の大きさを倍にすると、長さも倍
    const m2 = await t.measureText(text, { ...style, fontSize: 36 });
    expect(m2.inlineSize).toBeCloseTo(m.inlineSize * 2, 3);
  });

  it('改行を残す指定 (pre-wrap) は改行で行を分け、ほかは 1 行', async () => {
    expect((await t.measureText('一行目\n二行目', { whiteSpace: 'pre-wrap' })).lineCount).toBe(2);
    expect((await t.measureText('一行目\n二行目', {})).lineCount).toBe(1);
    expect((await t.measureText('', {})).lineCount).toBe(0);
  });

  it('文書の中の文字の HTML の字 (<・&) も、そのまま文字として測る', async () => {
    const m = await t.measureText('<b>&amp;</b>', {});
    expect(m.lines[0].text).toBe('<b>&amp;</b>');
  });
});

describe('Typesetter の再利用のキャッシュ', () => {
  // 前の文書から使い回した page-sequence の数 (adoptPrev が付け替えた数)
  let adopted = 0;
  const proto = LayoutEngine.prototype as unknown as { adoptPrev: (...a: unknown[]) => boolean };
  const adoptPrev = proto.adoptPrev;
  beforeAll(() => {
    proto.adoptPrev = function (...a: unknown[]) {
      const r = adoptPrev.apply(this, a);
      if (r) adopted++;
      return r;
    };
  });
  afterAll(() => {
    proto.adoptPrev = adoptPrev;
  });

  it('測っても、前に組んだ文書のページの使い回しは変わらない', async () => {
    const doc = `<!DOCTYPE html><html lang="ja"><body>${'<p>吾輩は猫である。名前はまだ無い。</p>'.repeat(40)}</body></html>`;
    await t.typeset(doc);
    adopted = 0;
    await t.typeset(doc);
    const without = adopted;
    expect(without).toBeGreaterThan(0);
    adopted = 0;
    await t.measureText('見出し', { fontSize: 20 });
    await t.breakLines('吾輩は猫である。', {}, 50);
    expect(adopted).toBe(0);
    await t.typeset(doc);
    expect(adopted).toBe(without);
  });
});

describe('選択肢のエラー (KumioriOptionError)', () => {
  const option = async (p: Promise<unknown>) => {
    const e = await p.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(KumioriOptionError);
    return (e as KumioriOptionError).option;
  };
  it('知らないプロパティ・値の形・宣言の外に出る字・行の長さ', async () => {
    expect(await option(t.measureText(1 as never, {}))).toBe('text');
    expect(await option(t.measureText('a', { color: 'red' } as never))).toBe('style.color');
    expect(await option(t.measureText('a', { fontSize: Number.NaN }))).toBe('style.fontSize');
    expect(await option(t.measureText('a', { fontStyle: 3 } as never))).toBe('style.fontStyle');
    expect(await option(t.measureText('a', { fontFamily: 'serif; color: red' }))).toBe('style.fontFamily');
    expect(await option(t.measureText('a', { fontFamily: 'x} body { width: 1pt' }))).toBe('style.fontFamily');
    expect(await option(t.measureText('a', { fontFamily: 'url(x)' }))).toBe('style.fontFamily');
    expect(await option(t.measureText('a', { lang: 'ja"><script>' }))).toBe('style.lang');
    expect(await option(t.breakLines('a', {}, 0))).toBe('width');
    expect(await option(t.breakLines('a', {}, Number.POSITIVE_INFINITY))).toBe('width');
    expect(await option(t.breakLines('a', {}, undefined as never))).toBe('width');
  });
});
