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

describe('ロシア語・ウクライナ語・現代ギリシャ語の分綴', () => {
  const split = (word: string, lang: string | undefined) => {
    const pos = hyphenPositions(word, lang);
    if (!pos) return undefined;
    const cs = [...word];
    return cs.map((c, k) => (pos.includes(k) ? `${c}-` : c)).join('');
  };
  it('各言語の規則 (hyph-utf8 の ru・uk・el-monoton) のとおりに分かれる', async () => {
    for (const l of ['ru', 'uk', 'el']) expect(await loadHyphenator(l)).toBeDefined();
    expect(split('информация', 'ru')).toBe('ин-фор-ма-ция');
    expect(split('свободными', 'ru')).toBe('сво-бод-ны-ми');
    expect(split('человек', 'ru-RU')).toBe('че-ло-век');
    expect(split('інформація', 'uk')).toBe('ін-фор-ма-ція');
    expect(split('народжуються', 'uk')).toBe('на-ро-джу-ю-ться');
    expect(split('πληροφορία', 'el')).toBe('πλη-ρο-φο-ρία');
    expect(split('δικαιώματα', 'el-GR')).toBe('δι-καιώ-μα-τα');
  });
  it('多調の綴りのギリシャ語・古典ギリシャ語・規則の無い言語は分綴しない。語の字に数える字は、言語で決まる', async () => {
    expect(await loadHyphenator('el-polyton')).toBeUndefined();
    expect(await loadHyphenator('grc')).toBeUndefined();
    expect(await loadHyphenator('vi')).toBeUndefined();
    expect(split('πληροφορία', 'el-polyton')).toBeUndefined();
    expect(split('информация', 'be')).toBeUndefined();
    expect(hyphenationLetters('ru')?.test('я')).toBe(true);
    expect(hyphenationLetters('uk')?.test('ї')).toBe(true);
    expect(hyphenationLetters('el')?.test('ώ')).toBe(true);
    expect(hyphenationLetters('ru')?.test('ω')).toBe(false);
    expect(hyphenationLetters('en')).toBeUndefined();
    expect(hyphenationLetters(undefined)).toBeUndefined();
  });
  it('狭い箱で、語の途中にハイフンを付けて折り返す。lang が無い・違う言語のときは折り返さない', async () => {
    const { FontManager } = await import('../src/fontManager');
    const { Measurer } = await import('../src/measurer');
    const { LayoutEngine } = await import('../src/layoutEngine');
    const { defaultFontBuffer, doc, walk } = await import('./helpers');
    for (const l of ['ru', 'uk', 'el', 'en', 'de', 'pl', 'bg', 'ca', 'pt']) await loadHyphenator(l);
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
    expect(lines('информация', 'ru', 30)[0]).toMatch(/^(ин|инфор)-$/);
    expect(lines('інформація', 'uk', 30)[0]).toMatch(/^(ін|інфор)-$/);
    expect(lines('πληροφορία', 'el', 30)[0]).toMatch(/^(πλη|πληρο)-$/);
    // 言語の指定が無い (英語の規則)・別の言語: ハイフンは出ない (語は、はみ出すか字の間で折れる)
    for (const lang of [undefined, 'en', 'be', 'el']) expect(lines('информация', lang, 30).join('|')).not.toContain('-');
    expect(lines('πληροφορία', 'ru', 30).join('|')).not.toContain('-');
    // 足した言語: ドイツ語・ポーランド語 (ラテン拡張 A の字を含む語)・ブルガリア語。規則の無い言語 (チェコ語) では分けない
    expect(lines('Silbentrennung', 'de', 40)[0]).toMatch(/^(Sil|Silben)-$/);
    expect(lines('przedsiębiorstwo', 'pl', 50)[0]).toMatch(/^(przed|przedsię)-$/);
    expect(lines('информация', 'bg', 30)[0]).toMatch(/^(ин|инфор)-$/);
    expect(lines('přizpůsobení', 'cs', 30).join('|')).not.toContain('-');
    // 上流の hyphenmins が 2・3 の言語 (ポルトガル語など) は、終わりに 3 字を残す (es-co-la の co-la では分けない)。
    // hyphenate-limit-chars で前後の字数を指定したときは、指定のほう
    expect(lines('escola', 'pt', 26)[0]).toBe('es-');
    const ptLimited = engine.layout(doc([{ type: 'block', width: 26, hyphenate: true, hyphenLimits: { minWord: 5, minBefore: 2, minAfter: 2 }, textAlign: 'start', language: 'pt', children: ['escola'] } as never]));
    const firstLine: string[] = [];
    walk(ptLimited.sheets[0].page.regionBody, (a) => {
      if (a.type !== 'line' || firstLine.length) return;
      let t = '';
      walk(a, (g) => {
        if (g.type === 'glyph') t += (g as unknown as { text: string }).text;
      });
      firstLine.push(t);
    });
    expect(firstLine[0]).toBe('esco-');
    // カタルーニャ語の l·l (中黒) の所では分けない (分けると字が変わるため。中黒は語の字に数えない)
    expect(lines('col·lecció', 'ca', 30).join('|')).not.toMatch(/col·-|col-/);
  });
});

describe('言語のタグから分綴の規則を選ぶ (hyphenationKey)', () => {
  it('BCP 47 のタグを、言語・文字・地域・異形で読む', async () => {
    const { hyphenationKey } = await import('../src/hyphenation');
    const cases: Array<[string | undefined, string | undefined]> = [
      [undefined, 'en-us'], ['en', 'en-us'], ['en-US', 'en-us'], ['en-GB', 'en-gb'], ['en_GB', 'en-gb'], ['en-Latn-GB', 'en-gb'], ['EN-gb-oxendict', 'en-gb'],
      ['la', 'la'], ['la-x-classic', 'la'], ['ru-RU', 'ru'], ['uk', 'uk'], ['el', 'el-monoton'], ['el-GR', 'el-monoton'], ['el-polyton', undefined],
      // ISO 639-2 の 3 字の符号 (XSL-FO の language)
      ['eng', 'en-us'], ['eng-GB', 'en-gb'], ['rus', 'ru'], ['ukr', 'uk'], ['lat', 'la'], ['gre', 'el-monoton'], ['ell', 'el-monoton'],
      // 文字が規則の文字と違えば当てない
      ['ru-Latn', undefined], ['en-Cyrl', undefined], ['ru-Cyrl', 'ru'],
      // 規則の無い言語・空のタグ
      ['', undefined], ['x-klingon', undefined], ['vi', undefined], ['cs', undefined], ['ja', undefined], ['grc', undefined],
    ];
    for (const [tag, key] of cases) expect([tag, hyphenationKey(tag)]).toEqual([tag, key]);
  });
  it('XSL-FO の 3 字の符号の言語 (language="eng") でも、規則を読み込んで分綴する', async () => {
    const { loadFoHyphenators } = await import('../src/compat');
    await loadFoHyphenators('<fo:block hyphenate="true" language="rus">информация</fo:block>');
    expect(hyphenPositions('информация', 'rus')?.length).toBeGreaterThan(0);
    expect(hyphenPositions('internationalization', 'eng')?.length).toBeGreaterThan(0);
    await loadFoHyphenators('<fo:block hyphenate="true" language="deu" country="CH">Silbentrennung</fo:block>');
    expect(hyphenPositions('Silbentrennung', 'deu-CH')).toEqual([2, 5, 9]);
  });
});

describe('足した言語の分綴 (hyph-utf8 の、MIT などの許諾の緩いパターン)', () => {
  const split = (word: string, lang: string) => {
    const pos = hyphenPositions(word, lang);
    if (!pos) return undefined;
    const cs = [...word];
    return cs.map((c, k) => (pos.includes(k) ? `${c}-` : c)).join('');
  };
  const CASES: Array<[string, string[]]> = [
    ['de', ['Sil-ben-tren-nung', 'Do-nau-dampf-schiff-fahrt']],
    ['de-CH-1901', ['Stras-se']],
    ['de-1901', ['Sil-ben-tren-nung']],
    ['fr', ['hy-phé-na-tion', 'dé-ve-lop-pe-ment']],
    ['es', ['in-for-ma-ción', 'de-sa-rro-llo']],
    ['it', ['in-for-ma-zio-ne', 'svi-lup-po']],
    ['pt-BR', ['in-for-ma-ção', 'de-sen-vol-vi-men-to']],
    ['nl', ['woord-af-bre-king', 'ont-wik-ke-ling']],
    ['pl', ['przed-się-bior-stwo', 'in-for-ma-cja']],
    ['da', ['ud-vik-ling']],
    ['nb', ['ut-vik-ling']],
    ['nn', ['in-for-ma-sjon']],
    ['no', ['in-for-ma-sjon']],
    ['fi', ['tie-to-ko-ne', 'ke-hi-tys']],
    ['sk', ['in-for-má-cia']],
    ['sl', ['in-for-ma-ci-ja']],
    ['hr', ['in-for-ma-ci-ja']],
    ['et', ['in-for-mat-sioon']],
    ['lt', ['in-for-ma-ci-ja']],
    ['ga', ['eol-aí-ocht']],
    ['cy', ['gwybod-aeth']],
    ['gl', ['in-for-ma-ción']],
    ['eu', ['hiz-kun-tza', 'ga-ra-pe-na']],
    ['bg', ['ин-фор-ма-ция']],
    // LPPL だけのパターン
    ['sv', ['ut-veck-ling', 'in-for-ma-tion']],
    ['ca', ['in-for-ma-ció', 'desen-vo-lu-pa-ment']],
    ['is', ['upp-lýs-ing-ar']],
    ['tr', ['bil-gi-sa-yar', 'ge-liş-tir-me']],
    ['sr-Latn', ['in-for-ma-ci-ja']],
    ['sr', ['ин-фор-ма-ци-ја']],
    ['sr-Cyrl-RS', ['ин-фор-ма-ци-ја']],
    // MPL 1.1 のパターン
    ['hu', ['in-for-má-ció', 'fej-lesz-tés', 'szó-ta-go-lás']],
  ];
  it('各言語の規則のとおりに分かれる', async () => {
    for (const [l, words] of CASES) {
      expect([l, !!(await loadHyphenator(l))]).toEqual([l, true]);
      for (const w of words) expect([l, split(w.replace(/-/g, ''), l)]).toEqual([l, w]);
    }
  });
  it('言語のタグの異形・地域・3 字の符号で規則を選ぶ', async () => {
    const { hyphenationKey } = await import('../src/hyphenation');
    const cases: Array<[string, string | undefined]> = [
      ['de', 'de-1996'], ['de-DE', 'de-1996'], ['de-AT', 'de-1996'], ['de-CH', 'de-1996'], ['de-1996', 'de-1996'], ['de-DE-1901', 'de-1901'],
      ['de-CH-1901', 'de-ch-1901'], ['de-LI-1901', 'de-ch-1901'], ['deu', 'de-1996'], ['ger-CH', 'de-1996'], ['gsw', undefined],
      ['pt-BR', 'pt'], ['pt-PT', 'pt'], ['por', 'pt'], ['fr-CA', 'fr'], ['fre', 'fr'], ['nb', 'nb'], ['nn', 'nb'], ['no', 'nb'], ['no-bok', 'nb'], ['nob', 'nb'],
      ['bg', 'bg'], ['bg-Latn', undefined], ['cy-GB', 'cy'], ['wel', 'cy'], ['de-Cyrl', undefined], ['bs', undefined],
      ['cs', undefined], ['id', undefined], ['mk', undefined], ['lv', undefined], ['ro', undefined],
      ['sv-FI', 'sv'], ['swe', 'sv'], ['cat', 'ca'], ['ice', 'is'], ['tur', 'tr'],
      ['sr', 'sh-cyrl'], ['sr-RS', 'sh-cyrl'], ['sr-Cyrl', 'sh-cyrl'], ['sr-Latn', 'sh-latn'], ['sr-ME', 'sh-latn'], ['sr-Latn-RS', 'sh-latn'], ['srp', 'sh-cyrl'],
      ['sh', 'sh-latn'], ['sh-Cyrl', 'sh-cyrl'], ['hr', 'hr'], ['bs', undefined], ['hu-HU', 'hu'], ['hun', 'hu'],
    ];
    for (const [tag, key] of cases) expect([tag, hyphenationKey(tag)]).toEqual([tag, key]);
  });
  it('上流の hyphenmins が 2・2 と違う言語だけ、語の初めと終わりに残す字数を持つ (前からある言語は持たない)', async () => {
    const { hyphenationMinimums } = await import('../src/hyphenation');
    for (const l of ['pt', 'pt-BR', 'sk', 'ga', 'cy', 'et']) expect([l, hyphenationMinimums(l)]).toEqual([l, [2, 3]]);
    for (const l of ['en', 'en-GB', 'la', 'ru', 'uk', 'el', 'de', 'fr', 'hu', 'cs', undefined]) expect([l, hyphenationMinimums(l)]).toEqual([l, undefined]);
  });
  it('ブルガリア語ではキリル文字を、ウェールズ語ではラテン拡張追加の字を、語の字に数える', () => {
    expect(hyphenationLetters('bg')?.test('ж')).toBe(true);
    expect(hyphenationLetters('cy')?.test('ẃ')).toBe(true);
    expect(hyphenationLetters('de')).toBeUndefined();
    expect(hyphenationLetters('sr')?.test('ђ')).toBe(true);
    expect(hyphenationLetters('sr-Latn')).toBeUndefined();
  });
  it('読み込む規則のすべてに、チャンクの著作権とライセンスの表示がある (表示の無い規則はビルドが止まる)', async () => {
    const { HYPHENATION_PATTERNS } = await import('../src/hyphenation');
    const { HYPHEN_NOTICES } = await import('../src/hyphenationNotices');
    expect([...HYPHENATION_PATTERNS].sort()).toEqual(Object.keys(HYPHEN_NOTICES).sort());
    // ビルドは、モジュールの id からパターンの名前を取り出して表示を選ぶ (数字を含む名前 de-1996 も)
    const { hyphenPatternOf } = await import('../src/hyphenationNotices');
    for (const n of HYPHENATION_PATTERNS) expect(hyphenPatternOf(`/x/node_modules/hyphen/patterns/${n}.js`)).toBe(n);
    expect(hyphenPatternOf('C:\\x\\node_modules\\hyphen\\patterns\\de-1996.js?commonjs-es-import')).toBe('de-1996');
    expect(hyphenPatternOf('/x/node_modules/hyphen/de-1996/index.js')).toBeUndefined();
    // 配れないライセンス (GPL・LGPL だけ、ライセンスの表示の無い) のパターンは読み込まない
    for (const n of ['cs', 'id', 'mk', 'sr-cyrl', 'lv', 'ro']) expect(HYPHENATION_PATTERNS).not.toContain(n);
  });
});
