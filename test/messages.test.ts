/**
 * 文言の言語 (src/messages.ts):
 *  - detectMessageLang: KUMIORI_LANG → LC_ALL・LC_MESSAGES・LANG。決まらなければ日本語
 *  - withMessageLang: 呼び出しの間だけ切り替え、終わったら戻す (重なった呼び出しは、置き場所ごとに確かめる)
 *  - typeset の lang: 警告が英語になり、ほかの呼び出しには残らない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { detectMessageLang, messageLang, msg, setMessageLang, withMessageLang } from '../src/messages';
import { DEFAULT_FONTS, typesetHtml } from '../src/index';
import { __setCallStoreForTest, rejoin, thisCall } from '../src/callContext';
import { ensureFonts, loadCachedFont } from './helpers';

// 既定の書体は置き場 (.cache/fonts) から読む。無ければ、テストの前に 1 度だけ取得して置く (helpers の ensureFonts)
const loadFont = loadCachedFont;
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

describe('文言の言語', () => {
  it('環境から決める: KUMIORI_LANG → LC_ALL → LC_MESSAGES → LANG。決まらなければ日本語', () => {
    expect(detectMessageLang({})).toBe('ja');
    expect(detectMessageLang({ LANG: 'C' })).toBe('ja');
    expect(detectMessageLang({ LANG: 'en_US.UTF-8' })).toBe('en');
    expect(detectMessageLang({ LANG: 'en_US.UTF-8', LC_MESSAGES: 'ja_JP.UTF-8' })).toBe('ja');
    expect(detectMessageLang({ LANG: 'ja_JP.UTF-8', LC_ALL: 'en_GB' })).toBe('en');
    expect(detectMessageLang({ LANG: 'en_US.UTF-8', KUMIORI_LANG: 'ja' })).toBe('ja');
    expect(detectMessageLang({ LANG: 'fr_FR.UTF-8' })).toBe('ja');
    expect(detectMessageLang({ KUMIORI_LANG: 'EN' })).toBe('en');
  });
  it('withMessageLang は呼び出しの間だけ切り替える', async () => {
    expect(messageLang()).toBe('ja');
    expect(msg('あ', 'a')).toBe('あ');
    const inside = await withMessageLang('en', async () => msg('あ', 'a'));
    expect(inside).toBe('a');
    expect(messageLang()).toBe('ja');
    await expect(withMessageLang('en', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(messageLang()).toBe('ja');
    setMessageLang('en');
    expect(msg('あ', 'a')).toBe('a');
    setMessageLang('ja');
  });
  // 呼び出しごとの文脈の置き場所 (src/callContext.ts) ごとに確かめる。
  // async (AsyncLocalStorage): 重なっても、それぞれの呼び出しの言語。module (AsyncLocalStorage の無い環境): await の後を rejoin で置き直せば同じ
  // (Kumiori の呼び出しの道筋の await は、どれも rejoin(thisCall(), await …) と書く)
  for (const kind of ['async', 'module'] as const) {
    it(`lang の違う呼び出しが重なっても、すべて終われば元の言語に戻る (終わる順によらない。置き場所 ${kind})`, async () => {
      expect(__setCallStoreForTest(kind)).toBe(true);
      try {
        // 呼び出しの重なりを、手で進める約束 (Promise) で作る (時間に頼らない)
        const gate = () => {
          let open!: () => void;
          const p = new Promise<void>((ok) => (open = ok));
          return { p, open };
        };
        for (const firstToEnd of ['a', 'b'] as const) {
          const ga = gate();
          const gb = gate();
          const seen: string[] = [];
          expect(messageLang()).toBe('ja');
          const a = withMessageLang('en', async () => {
            seen.push(`a:${msg('あ', 'a')}`);
            rejoin(thisCall(), await ga.p);
            seen.push(`a:${msg('あ', 'a')}`);
          });
          // 呼び出しを始めた後の、呼び出し元の同期の区間は、呼び出し元の言語のまま
          expect(messageLang()).toBe('ja');
          const b = withMessageLang('ja', async () => {
            seen.push(`b:${msg('あ', 'a')}`);
            rejoin(thisCall(), await gb.p);
            seen.push(`b:${msg('あ', 'a')}`);
          });
          if (firstToEnd === 'a') {
            ga.open();
            await a;
            // 残っている呼び出しは ja
            expect(messageLang()).toBe('ja');
            gb.open();
            await b;
            expect(seen).toEqual(['a:a', 'b:あ', 'a:a', 'b:あ']);
          } else {
            gb.open();
            await b;
            // 呼び出しの外は既定の言語
            expect(messageLang()).toBe('ja');
            ga.open();
            await a;
            expect(seen).toEqual(['a:a', 'b:あ', 'b:あ', 'a:a']);
          }
          expect(messageLang()).toBe('ja');
          expect(msg('あ', 'a')).toBe('あ');
        }
        // 同じ言語どうしの重なりでも、外の既定には触らない
        setMessageLang('en');
        await Promise.all([withMessageLang('ja', async () => undefined), withMessageLang('en', async () => undefined)]);
        expect(messageLang()).toBe('en');
        setMessageLang('ja');
        // 投げても、呼び出しの外に戻る (同期で投げたときも)
        await expect(withMessageLang('en', async () => { throw new Error('x'); })).rejects.toThrow('x');
        await expect(withMessageLang('en', (() => { throw new Error('y'); }) as () => Promise<void>)).rejects.toThrow('y');
        expect(messageLang()).toBe('ja');
      } finally {
        __setCallStoreForTest('async');
      }
    });
  }
  it('typeset の lang: 警告が英語になり、次の呼び出し (lang 無し) は日本語のまま', async () => {
    const html = '<!DOCTYPE html><html><head><title>t</title><style>.g { display: grid; grid-template-areas: "a b" } p { colr: red }</style></head><body><div class="g"><p>a</p></div></body></html>';
    const en = await typesetHtml(html, { name: 't.html', loadFont, lang: 'en' });
    expect(en.warnings).toContain('ignored unsupported CSS: grid-template-areas');
    expect(en.warnings).toContain('ignored unknown CSS properties (misspelled or unsupported): colr');
    const ja = await typesetHtml(html, { name: 't.html', loadFont });
    expect(ja.warnings).toContain('未対応の CSS を無視しました: grid-template-areas');
    expect(ja.warnings.some((w) => /^ignored/.test(w))).toBe(false);
    // 知らない値は誤り
    await expect(typesetHtml(html, { name: 't.html', loadFont, lang: 'fr' as never })).rejects.toThrow(/lang/);
  });
});
