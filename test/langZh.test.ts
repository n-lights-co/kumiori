/**
 * 中国語 (簡体字・繁体字) の組版。
 * - 圏点 (着重号) の位置: text-emphasis-position の under (横書きは字の下)・left (縦書きは字の左)。中国語 (lang が zh) の既定は under right
 *   (CSS Text Decoration 3 §3.4 と付録 B の UA の既定のスタイルシート https://www.w3.org/TR/css-text-decor-3/ 2026-11-10 取得:
 *   「:root:lang(zh), [lang|=zh] { text-emphasis-position: under right; }」「[lang|=ja], [lang|=ko] { text-emphasis-position: over right; }」。
 *   clreq §5.3.1 https://www.w3.org/TR/clreq/ 2026-11-10 取得: 横書きの着重号は字の下、縦書きは字の右)
 * - ルビの注音符号 (ボポモフォ)・拼音 (ラテン文字) は、字の間を空けずにまとめて中央に置く (CSS Ruby 1 §4.3 https://drafts.csswg.org/css-ruby-1/
 *   2026-11-10 取得: 「defining justification opportunities between every adjacent pair of CJK characters but not between adjacent pairs of
 *   Latin or Bopomofo characters. Thus, the space-around and space-between values will nevertheless result in Latin or Bopomofo characters centered」)。
 *   ラテン文字は、中国語 (lang が zh) のルビだけ (ほかの言語のルビの欧字は、今までどおり字ごとに割る)
 * - <html lang="zh-…"> の言語を、文書の字の言語にする (HTML Living Standard §3.2.6.2)。ほかの言語は今までどおり
 * - quotes: auto の引用符 (q 要素): 簡体字の中国語は “ ” ‘ ’、繁体字は 「 」 『 』 (CSS Content 3 §4.1 https://drafts.csswg.org/css-content-3/
 *   2026-11-10 取得: auto は言語に合う引用符を UA が選ぶ。注は CLDR を挙げる。CLDR 46 の zh は親 (root) の “ ” ‘ ’、zh_Hant は 「 」 『 』)
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { importHtml } from '../src/htmlImport';
import { cascadeStyles } from '../src/cssCascade';
import type { Area, LPageSequence, LRuby } from '../src/types';
import { doc, makeEngine } from './helpers';

const conv = (html: string, css = '') => {
  const d = new DOMParser().parseFromString(html, 'text/html') as unknown as Document;
  return importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css }).document.sequences[0] as LPageSequence;
};
/** body の最初の段落の子 (圏点はルビ) を [親文字, 上のルビ, 下のルビ] にする */
const marks = (seq: LPageSequence) => {
  const out: Array<[string, string, string | undefined]> = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const r = n as LRuby;
    if (r.type === 'ruby') out.push([r.baseText, r.rubyText, r.rubyTextUnder]);
    for (const c of (n as { children?: unknown[] }).children ?? []) visit(c);
  };
  visit(seq.flow);
  return out;
};

describe('圏点の位置 (text-emphasis-position)', () => {
  const page = (attrs: string, body: string, css = 'em { text-emphasis-style: filled dot }') => conv(`<html${attrs}><head></head><body>${body}</body></html>`, css);
  it('under は字の下 (2 段目のルビの位置)、over・指定なしは字の上', () => {
    expect(marks(page('', '<p><em style="text-emphasis-position: under right">重点</em></p>'))).toEqual([['重', '', '•'], ['点', '', '•']]);
    expect(marks(page('', '<p><em style="text-emphasis-position: under">重</em></p>'))).toEqual([['重', '', '•']]);
    expect(marks(page('', '<p><em style="text-emphasis-position: over right">重</em></p>'))).toEqual([['重', '•', undefined]]);
    expect(marks(page('', '<p><em>重</em></p>'))).toEqual([['重', '•', undefined]]);
  });
  it('縦書きは right・left で決まる (under・over は効かない)', () => {
    const css = 'body { writing-mode: vertical-rl } em { text-emphasis-style: filled sesame }';
    expect(marks(page('', '<p><em style="text-emphasis-position: over left">重</em></p>', css))).toEqual([['重', '', '﹅']]);
    expect(marks(page('', '<p><em style="text-emphasis-position: under right">重</em></p>', css))).toEqual([['重', '﹅', undefined]]);
  });
  it('中国語 (lang が zh) の既定は字の下。日本語・韓国語・言語の指定なしは字の上。指定があれば指定のとおり', () => {
    expect(marks(page(' lang="zh-Hans"', '<p><em>重</em></p>'))).toEqual([['重', '', '•']]);
    expect(marks(page('', '<p lang="zh-Hant"><em>重</em></p>'))).toEqual([['重', '', '•']]);
    expect(marks(page(' lang="ja"', '<p><em>重</em></p>'))).toEqual([['重', '•', undefined]]);
    expect(marks(page(' lang="zh"', '<p lang="ja"><em>重</em></p><p lang="ko"><em>点</em></p>'))).toEqual([['重', '•', undefined], ['点', '•', undefined]]);
    expect(marks(page(' lang="zh"', '<p><em style="text-emphasis-position: over">重</em></p>'))).toEqual([['重', '•', undefined]]);
  });
  it('縦書きの中国語の既定 (under right) は字の右', () => {
    expect(marks(page(' lang="zh-Hant"', '<p><em>重</em></p>', 'body { writing-mode: vertical-rl } em { text-emphasis-style: filled dot }'))).toEqual([['重', '•', undefined]]);
  });
});

describe('文書の言語 (html の lang)', () => {
  const lang = (html: string) => conv(html).language;
  it('<html lang="zh-…"> は文書の字の言語になる。body の lang があれば、そちら', () => {
    expect(lang('<html lang="zh-Hans"><head></head><body><p>字</p></body></html>')).toBe('zh-Hans');
    expect(lang('<html lang="zh-Hant"><head></head><body lang="zh-Hans"><p>字</p></body></html>')).toBe('zh-Hans');
    expect(lang('<html lang="zh-Hant"><head></head><body lang="ja"><p>字</p></body></html>')).toBe('ja');
  });
  it('ほかの言語は今までどおり (html の lang は、字の言語にしない)', () => {
    expect(lang('<html lang="ja"><head></head><body><p>字</p></body></html>')).toBeUndefined();
    expect(lang('<html lang="en"><head></head><body><p>a</p></body></html>')).toBeUndefined();
    expect(lang('<html><head></head><body lang="ja"><p>字</p></body></html>')).toBe('ja');
  });
});

describe('ルビの注音符号・拼音の置き方 (CSS Ruby 1 §4.3)', () => {
  /** ルビの中の字 (親文字 1 字の後ろに並ぶルビの字) の [x, 幅] */
  const rubyGlyphs = async (rubyText: string, baseText: string, language?: string) => {
    const E = await makeEngine();
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', ...(language ? { language } : {}), children: [{ type: 'ruby', baseText, rubyText }] }] as never));
    const out: Array<[number, number]> = [];
    const visit = (a: Area) => {
      if (a.type === 'ruby') for (const g of a.ruby) out.push([g.x, g.width]);
      for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c);
    };
    for (const c of t.sheets[0].page.regionBody.children) visit(c);
    return out;
  };
  /** 隣り合う字の間の空き */
  const gaps = (g: Array<[number, number]>) => g.slice(1).map((x, k) => x[0] - (g[k][0] + g[k][1]));
  it('注音符号と声調の記号は、間を空けずにまとめて中央に置く (言語によらない)', async () => {
    // 親文字 3 字 (30pt) に、注音符号 1 字 (5pt) + 声調 (3pt)
    const g = await rubyGlyphs('ㄗˋ', '漢字字');
    expect(gaps(g)[0]).toBeCloseTo(0, 5);
    expect(g[0][0]).toBeCloseTo((30 - 8) / 2, 5);
  });
  it('拼音 (ラテン文字) は、中国語のルビではまとめて中央に置く', async () => {
    const g = await rubyGlyphs('zì', '漢字字', 'zh-Hans');
    expect(gaps(g)[0]).toBeCloseTo(0, 5);
    const w = g[0][1] + g[1][1];
    expect(g[0][0]).toBeCloseTo((30 - w) / 2, 5);
  });
  it('ほかの言語 (言語の指定なし・日本語) のルビの欧字・仮名は、今までどおり字ごとに割る', async () => {
    for (const lang of [undefined, 'ja']) {
      const g = await rubyGlyphs('zi', '漢字字', lang);
      const w = g[0][1] + g[1][1];
      expect(gaps(g)[0]).toBeCloseTo((30 - w) / 2, 5);
      expect(g[0][0]).toBeCloseTo((30 - w) / 4, 5);
    }
    const k = await rubyGlyphs('かん', '漢字字', 'zh-Hans');
    expect(gaps(k)[0]).toBeCloseTo(10, 5);
  });
});

describe('quotes: auto の中国語の引用符 (CSS Content 3 §4.1)', () => {
  const text = (lang: string) => JSON.stringify(conv(`<html><head></head><body><p lang="${lang}"><q>甲<q>乙</q></q></p></body></html>`).flow);
  it('簡体字 (zh・zh-Hans・zh-CN・zh-SG) は “ ” ‘ ’', () => {
    for (const l of ['zh', 'zh-Hans', 'zh-CN', 'zh-SG', 'zh-Hans-CN']) expect(text(l), l).toMatch(/“.*甲.*‘.*乙.*’.*”/);
  });
  it('繁体字 (zh-Hant・zh-TW・zh-HK・zh-MO) は 「 」 『 』。日本語は今までどおり 「 」 『 』', () => {
    for (const l of ['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant-TW', 'ja']) expect(text(l), l).toMatch(/「.*甲.*『.*乙.*』.*」/);
  });
});
