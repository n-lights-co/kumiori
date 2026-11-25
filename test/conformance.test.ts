/**
 * 対応仕様説明書 (docs/conformance) の見本を、1 つずつテストとして組む (日本語版の 2 冊。英語版の 2 冊は test/conformanceEn.test.ts。
 * 中身は test/conformanceSuite.ts。vitest はファイルごとに別のワーカーで並べて走らせるので、日本語版と英語版を並べて組める)。
 * 指紋は test/fingerprints/conformance.json。見本の書体の一覧 (scripts/conformance-fonts.mjs) の確かめも、ここにある
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error 型の無い JavaScript のモジュール
import { fontUrlsIn } from '../scripts/conformance-fonts.mjs';
import { conformanceSuite, root, sampleFontByUrl, sampleFonts } from './conformanceSuite';

describe('対応仕様説明書の見本の書体 (scripts/conformance-fonts.mjs)', () => {
  const texts = ['fo/kumiori-xsl-fo.fo', 'fo/kumiori-xsl-fo.en.fo', 'html/kumiori-html-css.html', 'html/kumiori-html-css.en.html'].map((f) => fs.readFileSync(path.join(root, f), 'utf8'));
  it('説明書の中の配信元の URL は、すべて一覧にある', () => {
    for (const t of texts) for (const url of fontUrlsIn(t) as string[]) expect(sampleFontByUrl.has(url), url).toBe(true);
  });
  it('一覧の書体は、どれも説明書で使っている (HTML は URL、XSL-FO は書体の名前)', () => {
    for (const f of sampleFonts) {
      // XSL-FO 編だけで使う書体 (HTML 編では既定の書体で組むヘブライ文字) もある
      const inHtml = texts[2].includes(f.url) && texts[3].includes(f.url);
      const inFo = !!f.fo && texts.slice(0, 2).every((t) => t.includes(`font-family="${f.family}"`));
      expect(inHtml || inFo, f.file).toBe(true);
      if (f.fo) expect(inFo, f.file).toBe(true);
    }
  });
  it('置き場での名前と、URL の末尾の名前 (HTML 編を組むときの名前) が重ならない', () => {
    expect(new Set(sampleFonts.map((f) => f.file)).size).toBe(sampleFonts.length);
    expect(new Set(sampleFonts.map((f) => f.url.split('/').pop()!.toLowerCase())).size).toBe(sampleFonts.length);
  });
});

conformanceSuite(
  [
    { kind: 'fo', dir: 'fo', file: 'kumiori-xsl-fo.fo' },
    { kind: 'html', dir: 'html', file: 'kumiori-html-css.html' },
  ],
  'conformance',
);
