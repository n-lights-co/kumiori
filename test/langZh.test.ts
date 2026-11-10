/**
 * 中国語 (簡体字・繁体字) の組版。
 * - 圏点 (着重号) の位置の既定: 中国語 (lang が zh) は under right (横書きは字の下、縦書きは字の右)
 *   (CSS Text Decoration 3 §3.4 と付録 B の UA の既定のスタイルシート https://www.w3.org/TR/css-text-decor-3/ 2026-11-10 取得:
 *   「:root:lang(zh), [lang|=zh] { text-emphasis-position: under right; }」「[lang|=ja], [lang|=ko] { text-emphasis-position: over right; }」。
 *   clreq §5.3.1 https://www.w3.org/TR/clreq/ 2026-11-10 取得: 横書きの着重号は字の下、縦書きは字の右)
 * - ルビの注音符号 (ボポモフォ)・拼音 (ラテン文字) は、字の間を空けずにまとめて中央に置く (CSS Ruby 1 §4.3 https://drafts.csswg.org/css-ruby-1/
 *   2026-11-10 取得: 「defining justification opportunities between every adjacent pair of CJK characters but not between adjacent pairs of
 *   Latin or Bopomofo characters. Thus, the space-around and space-between values will nevertheless result in Latin or Bopomofo characters centered」)。
 *   配り方そのものは ruby-align の対応 (rubyOffsets) による。ここでは、注音符号の声調の記号と、声調の記号つきのラテン文字 (拼音) を確かめる
 * - <html lang> の言語を、文書の字の言語にする (HTML Standard §3.2.6.2 https://html.spec.whatwg.org/multipage/dom.html 2026-11-10 取得:
 *   「If these attributes are omitted from an element, then the language of this element is the same as the language of its parent element, if any」)
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

describe('圏点の位置の既定 (CSS Text Decoration 3 付録 B)', () => {
  const page = (attrs: string, body: string, css = 'em { text-emphasis-style: filled dot }') => conv(`<html${attrs}><head></head><body>${body}</body></html>`, css);
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

describe('文書の言語 (html の lang。HTML Standard §3.2.6.2)', () => {
  const lang = (html: string) => conv(html).language;
  it('<html lang> は文書の字の言語になる (どの言語でも)。body の lang があれば、そちら', () => {
    expect(lang('<html lang="zh-Hans"><head></head><body><p>字</p></body></html>')).toBe('zh-Hans');
    expect(lang('<html lang="ja"><head></head><body><p>字</p></body></html>')).toBe('ja');
    expect(lang('<html lang="en"><head></head><body><p>a</p></body></html>')).toBe('en');
    expect(lang('<html lang="zh-Hant"><head></head><body lang="ja"><p>字</p></body></html>')).toBe('ja');
    expect(lang('<html><head></head><body lang="ja"><p>字</p></body></html>')).toBe('ja');
    expect(lang('<html><head></head><body><p>字</p></body></html>')).toBeUndefined();
  });
  it('<html lang="ja"> だけの文書でも、line-break: normal の日本語の決まりが効く (〜 の前で折り返せる。CSS Text 3 §5.2)', async () => {
    const E = await makeEngine();
    const lines = (attrs: string) => {
      const seq = conv(`<html${attrs}><head></head><body><p>一二三四五六〜七八九十</p></body></html>`, '@page { size: 100mm 100mm; margin: 10mm } body { margin: 0 } p { margin: 0; font-size: 10pt; width: 60pt; text-indent: 0; text-align: left; line-break: normal }');
      const t = E.engine.layout({ type: 'document', sequences: [seq] } as never);
      const ys = new Map<number, string>();
      const visit = (a: Area, oy: number) => {
        const y = oy + a.y;
        if (a.type === 'line') ys.set(Math.round(y), '');
        for (const c of (a as unknown as { children?: Area[] }).children ?? []) visit(c, y);
      };
      for (const c of t.sheets[0].page.regionBody.children) visit(c, 0);
      const out: string[] = [];
      const walkLine = (a: Area): string => (a.type === 'glyph' ? (a as unknown as { text: string }).text : ((a as unknown as { children?: Area[] }).children ?? []).map(walkLine).join(''));
      const find = (a: Area) => {
        if (a.type === 'line') out.push(walkLine(a));
        else for (const c of (a as unknown as { children?: Area[] }).children ?? []) find(c);
      };
      for (const c of t.sheets[0].page.regionBody.children) find(c);
      return out;
    };
    expect(lines(' lang="ja"')).toEqual(['一二三四五六', '〜七八九十']);
    expect(lines(' lang="zh-Hant"')).toEqual(['一二三四五六', '〜七八九十']);
    // 日本語・中国語でない文書 (と、言語の分からない文書) では、〜 の前で折り返さない
    expect(lines(' lang="ko"')).toEqual(['一二三四五', '六〜七八九十']);
    expect(lines('')).toEqual(['一二三四五', '六〜七八九十']);
  });
});

describe('ルビの注音符号・拼音の置き方 (CSS Ruby 1 §4.3。HTML の既定の ruby-align: space-around)', () => {
  /** ルビの字の [x, 幅] */
  const rubyGlyphs = async (rubyText: string, baseText: string, language?: string) => {
    const E = await makeEngine();
    const t = E.engine.layout(doc([{ type: 'block', textAlign: 'start', rubyAlign: 'space-around', ...(language ? { language } : {}), children: [{ type: 'ruby', baseText, rubyText }] }] as never));
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
  it('注音符号と声調の記号は、間を空けずにまとめて中央に置く', async () => {
    // 親文字 3 字 (30pt) に、注音符号 2 字 (5pt ずつ) + 声調 (3pt)
    const g = await rubyGlyphs('ㄏㄢˋ', '漢字字');
    expect(gaps(g)[0]).toBeCloseTo(0, 5);
    expect(gaps(g)[1]).toBeCloseTo(0, 5);
    expect(g[0][0]).toBeCloseTo((30 - 13) / 2, 5);
  });
  it('拼音 (声調の記号つきのラテン文字) は、言語によらず、まとめて中央に置く', async () => {
    for (const lang of [undefined, 'zh-Hans', 'ja']) {
      const g = await rubyGlyphs('zì', '漢字字', lang);
      expect(gaps(g)[0]).toBeCloseTo(0, 5);
      expect(g[0][0]).toBeCloseTo((30 - (g[0][1] + g[1][1])) / 2, 5);
    }
  });
  it('仮名・漢字のルビは、字の間を空けて配る (中国語の文書でも)', async () => {
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
