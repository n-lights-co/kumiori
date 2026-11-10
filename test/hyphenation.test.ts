/**
 * 分綴の規則の読み込み: CSS のほか、要素の style 属性の hyphens: auto でも読み込む
 */
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { hyphenPositions, hyphenationLetters, loadDocumentHyphenators, loadHyphenator } from '../src/hyphenation';

describe('loadDocumentHyphenators', () => {
  it('style 属性の hyphens: auto でも、文書の言語の分綴の規則を読み込む', async () => {
    const { document } = parseHTML('<html lang="ja"><body><p lang="en" style="hyphens: auto">internationalization</p></body></html>');
    await loadDocumentHyphenators(document as unknown as Document, '');
    expect(hyphenPositions('internationalization', 'en')?.length).toBeGreaterThan(0);
  });
});

describe('ウクライナ語・現代ギリシャ語の分綴', () => {
  const split = (word: string, lang: string | undefined) => {
    const pos = hyphenPositions(word, lang);
    if (!pos) return undefined;
    const cs = [...word];
    return cs.map((c, k) => (pos.includes(k) ? `${c}-` : c)).join('');
  };
  it('各言語の規則 (hyph-utf8 の uk・el-monoton) のとおりに分かれる', async () => {
    for (const l of ['uk', 'el']) expect(await loadHyphenator(l)).toBeDefined();
    expect(split('інформація', 'uk')).toBe('ін-фор-ма-ція');
    expect(split('народжуються', 'uk')).toBe('на-ро-джу-ю-ться');
    expect(split('πληροφορία', 'el')).toBe('πλη-ρο-φο-ρία');
    expect(split('δικαιώματα', 'el-GR')).toBe('δι-καιώ-μα-τα');
  });
  it('多調の綴りのギリシャ語・古典ギリシャ語・規則の無い言語 (ロシア語など) は分綴しない。語の字に数える字は、言語で決まる', async () => {
    expect(await loadHyphenator('el-polyton')).toBeUndefined();
    expect(await loadHyphenator('grc')).toBeUndefined();
    expect(await loadHyphenator('vi')).toBeUndefined();
    // ロシア語 (ru) は、規則を入れていないので分かれない
    expect(await loadHyphenator('ru')).toBeUndefined();
    expect(split('информация', 'ru')).toBeUndefined();
    expect(hyphenationLetters('ru')).toBeUndefined();
    expect(split('πληροφορία', 'el-polyton')).toBeUndefined();
    expect(split('информация', 'bg')).toBeUndefined();
    expect(hyphenationLetters('uk')?.test('ї')).toBe(true);
    expect(hyphenationLetters('el')?.test('ώ')).toBe(true);
    expect(hyphenationLetters('uk')?.test('ω')).toBe(false);
    expect(hyphenationLetters('en')).toBeUndefined();
    expect(hyphenationLetters(undefined)).toBeUndefined();
  });
  it('狭い箱で、語の途中にハイフンを付けて折り返す。lang が無い・違う言語のときは折り返さない', async () => {
    const { FontManager } = await import('../src/fontManager');
    const { Measurer } = await import('../src/measurer');
    const { LayoutEngine } = await import('../src/layoutEngine');
    const { defaultFontBuffer, doc, walk } = await import('./helpers');
    for (const l of ['uk', 'el', 'en']) await loadHyphenator(l);
    const fonts = new FontManager();
    await fonts.registerBuffer('Arimo', 400, await defaultFontBuffer('Arimo-Regular.ttf'), false);
    const engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: 'Arimo', hyphenate: hyphenPositions });
    const lines = (text: string, language: string | undefined, width: number) => {
      const out: string[] = [];
      const tree = engine.layout(doc([{ type: 'block', width, hyphenate: true, textAlign: 'start', ...(language ? { language } : {}), children: [text] } as never]));
      walk(tree.sheets[0].page.regionBody, (a) => {
        if (a.type !== 'line') return;
        let s = '';
        walk(a, (g) => {
          if (g.type === 'glyph') s += (g as unknown as { text: string }).text;
        });
        out.push(s);
      });
      return out;
    };
    // 字の大きさ 10pt。語より狭く、最初の音節 + ハイフンより広い箱
    expect(lines('інформація', 'uk', 30)[0]).toMatch(/^(ін|інфор)-$/);
    expect(lines('πληροφορία', 'el', 30)[0]).toMatch(/^(πλη|πληρο)-$/);
    // 言語の指定が無い (英語の規則)・別の言語: ハイフンは出ない (語は、はみ出すか字の間で折れる)
    for (const lang of [undefined, 'en', 'bg', 'ru', 'el']) expect(lines('інформація', lang, 30).join('|')).not.toContain('-');
    expect(lines('πληροφορία', 'uk', 30).join('|')).not.toContain('-');
  });
});
