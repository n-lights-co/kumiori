/**
 * 呼び出しごとの文脈 (src/callContext.ts):
 *  - 違う lang の呼び出しを同時に走らせても、警告・誤りの文が、言語ごとに 1 つずつ組んだときと同じ
 *    (AsyncLocalStorage の置き場所と、無い環境のモジュールの変数の置き場所 (await の後の置き直し) の両方で)
 *  - 器 (createTypesetter) の typeset・結果の toPdf・renderPageToSvg も、組んだときの言語で書く
 *  - 違う上限 (limits) の呼び出しを同時に走らせても、それぞれの呼び出しの上限で組む
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTypesetter, DEFAULT_FONTS, typesetHtml, type TypesetResult } from '../src/index';
import { __setCallStoreForTest, currentCall } from '../src/callContext';
import { messageLang } from '../src/messages';
import { encodePngStored } from '../src/pixels';
import { ensureFonts, loadCachedFont } from './helpers';

const loadFont = loadCachedFont;
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

// 警告の出る文書: 未対応・知らない CSS、読めない画像 (resolveResource で await を挟む)
// 外の CSS (resolveResource で読む。知らないプロパティ)・@font-face の壊れた書体・壊れた SVG の画像も
const html =
  '<!DOCTYPE html><html><head><link rel="stylesheet" href="ext.css"><style>.g { display: grid; grid-template-areas: "a b" } p { colr: red }' +
  ' @font-face { font-family: Broken; src: url(broken.woff2) } .b { font-family: Broken }</style></head>' +
  '<body><div class="g"><p>a</p></div><p class="b">b <img src="missing.png"> <img src="broken.png"> <img src="bad.svg"></p></body></html>';
const resolveResource = async (url: string) => {
  // 取得の途中で、ほかの呼び出しが進むように間をあける
  await new Promise((ok) => setTimeout(ok, 5));
  if (/ext\.css$/.test(url)) return '.x { colour: blue; text-wrap-style: pretty }';
  if (/broken\.woff2$/.test(url)) return new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]);
  if (/bad\.svg$/.test(url)) return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><use href="#nothing"/><image href="none.png" width="5" height="5"/></svg>';
  return /broken\.png$/.test(url) ? new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) : undefined;
};

/** 組んで、組版の警告と、PDF の警告 (toPdf の後の warnings) と、SVG にした後の warnings を集める */
async function run(lang: 'ja' | 'en', typeset: (lang: 'ja' | 'en') => Promise<TypesetResult>) {
  const r = await typeset(lang);
  const layout = [...r.warnings];
  await new Promise((ok) => setTimeout(ok, 1));
  await r.toPdf();
  await r.renderPageToSvg(0);
  return { layout, all: [...r.warnings] };
}

for (const kind of ['async', 'module'] as const)
describe(`呼び出しごとの文脈 (置き場所 ${kind})`, () => {
  beforeAll(() => {
    expect(__setCallStoreForTest(kind)).toBe(true);
    return () => void __setCallStoreForTest('async');
  });

  it('違う lang の typeset を同時に走らせても、言語ごとに 1 つずつ組んだときと同じ警告になる', async () => {
    const one = (lang: 'ja' | 'en') => typesetHtml(html, { name: 't.html', loadFont, lang, resolveResource });
    const ja = await run('ja', one);
    const en = await run('en', one);
    expect(ja.layout.some((w) => w.includes('未対応の CSS'))).toBe(true);
    expect(en.layout.some((w) => w.includes('ignored unsupported CSS'))).toBe(true);
    const langs = ['en', 'ja', 'en', 'ja'] as const;
    const got = await Promise.all(langs.map((l) => run(l, one)));
    got.forEach((g, k) => expect(g).toEqual(langs[k] === 'ja' ? ja : en));
    // 呼び出しの外に戻る
    expect(currentCall()).toBeUndefined();
    expect(messageLang()).toBe('ja');
  }, 120_000);

  it('器の typeset を同時に走らせても混ざらない (lang を省いた呼び出しは、始めたときの既定の言語)', async () => {
    const t = await createTypesetter({ loadFont });
    const one = (lang: 'ja' | 'en') => t.typeset(html, { name: 't.html', resolveResource, ...(lang === 'en' ? { lang } : {}) });
    const ja = await run('ja', one);
    const en = await run('en', one);
    expect(ja).not.toEqual(en);
    const langs = ['ja', 'en', 'en', 'ja'] as const;
    const got = await Promise.all(langs.map((l) => run(l, one)));
    got.forEach((g, k) => expect(g).toEqual(langs[k] === 'ja' ? ja : en));
  }, 120_000);

  it('違う limits の呼び出しを同時に走らせても、それぞれの上限で組む', async () => {
    // 40×40 の PNG (約 6.5KB)。取得の途中で間をあけて返す。fileBytes: 1000 の呼び出しでは大きすぎて読まない
    const png = encodePngStored({ width: 40, height: 40, rgba: new Uint8Array(40 * 40 * 4).fill(200) });
    const doc = '<!DOCTYPE html><html><body><p><img src="a.png" style="width: 20pt"></p></body></html>';
    const one = (small: boolean) =>
      typesetHtml(doc, {
        name: 't.html',
        loadFont,
        resolveResource: async () => {
          await new Promise((ok) => setTimeout(ok, 5));
          return png;
        },
        ...(small ? { limits: { fileBytes: 1000 } } : {}),
      }).then((r) => r.warnings);
    const big = await one(false);
    const small = await one(true);
    expect(big).toEqual([]);
    expect(small.length).toBeGreaterThan(0);
    const order = [true, false, true, false];
    const got = await Promise.all(order.map((s) => one(s)));
    got.forEach((g, k) => expect(g).toEqual(order[k] ? small : big));
  }, 120_000);

  it('入口の選択肢の誤りの文も、その呼び出しの言語', async () => {
    const [ja, en] = await Promise.allSettled([
      typesetHtml(html, { name: 't.html', loadFont, lang: 'ja', fetchTimeoutMs: -1 }),
      typesetHtml(html, { name: 't.html', loadFont, lang: 'en', fetchTimeoutMs: -1 }),
    ]);
    expect(ja.status === 'rejected' && String(ja.reason)).toMatch(/正の数/);
    expect(en.status === 'rejected' && String(en.reason)).toMatch(/positive number/);
  });
});
