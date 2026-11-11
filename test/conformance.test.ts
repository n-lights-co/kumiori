/**
 * 対応仕様説明書 (docs/conformance) の見本を、1 つずつテストとして組む。
 * 見本は文書の中の <?kumiori-sample?> (FO)・<!--kumiori-sample--> (HTML) の印の間に一度だけ書かれている (scripts/conformance-lib.mjs)。
 * 確かめること: 例外を出さずに組めること、警告 (読めない画像・知らない要素など) が出ないこと、中身の字が紙面にあること。
 * 文書の全体も組んで、ページ番号の参照・しおりの飛び先が解けていることを確かめる。
 * 言語ごとの見本・絵文字の見本・可変フォントの見本の書体 (既定の書体に無い字・機能) は、scripts/conformance-fonts.mjs の一覧のもの。
 * 置き場 (.cache/fonts) に取得して (取得できなければ失敗する)、HTML には @font-face の URL の中身として (resolveResource)、XSL-FO には fonts で渡す。
 * テストの中からは、ネットワークへ書体を取りに行かせない (fetchStyles: false。一覧に無い URL を見本に書くと、警告が出て失敗する)。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetFo, typesetHtml, walkAreaTree, type FontSpec, type GlyphArea } from '../src/index';
// @ts-expect-error 型の無い JavaScript のモジュール
import { expand, extractSamples, standalone } from '../scripts/conformance-lib.mjs';
// @ts-expect-error 型の無い JavaScript のモジュール
import { CONFORMANCE_FONTS, fontUrlsIn } from '../scripts/conformance-fonts.mjs';
import { cachedFont, ensureFonts, fontDir } from './helpers';

type Sample = { id: string; raw: string; code: string };

const root = path.resolve(__dirname, '..', 'docs', 'conformance');
const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** 文書と同じ置き場の画像・CSS を、組むときのファイルとして渡す */
function filesOf(dir: string) {
  const out: Array<{ name: string; data: Uint8Array }> = [];
  for (const f of fs.readdirSync(path.join(root, dir, 'images'))) out.push({ name: `images/${f}`, data: fs.readFileSync(path.join(root, dir, 'images', f)) });
  for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => /\.css$/.test(n))) out.push({ name: f, data: fs.readFileSync(path.join(root, dir, f)) });
  return out;
}

const textOf = (tree: Parameters<typeof walkAreaTree>[0]) => {
  let t = '';
  walkAreaTree(tree, (a) => {
    if (a.type === 'glyph') t += (a as GlyphArea).text;
  });
  return t;
};

/** 見本の書体 (scripts/conformance-fonts.mjs): 置き場のファイルの名前・配信元の URL・書体の名前・XSL-FO 編でも使うか */
type SampleFont = { file: string; url: string; family: string; fo?: boolean };
const sampleFonts: SampleFont[] = CONFORMANCE_FONTS;
const sampleFontByUrl = new Map(sampleFonts.map((f) => [f.url, f]));
/** HTML の @font-face が指す配信元の URL の中身を、置き場のファイルから返す (一覧に無い参照は undefined) */
const resolveResource = (url: string) => {
  const f = sampleFontByUrl.get(url);
  return f ? new Uint8Array(fs.readFileSync(path.join(fontDir, f.file))) : undefined;
};
/** XSL-FO に渡す書体 (コマンドの --font と同じ) */
const foFonts = () => sampleFonts.filter((f) => f.fo).map((f) => ({ name: f.file, data: new Uint8Array(fs.readFileSync(path.join(fontDir, f.file))) }));

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
  await Promise.all(sampleFonts.map((f) => cachedFont(f.file, f.url)));
}, 300_000);

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

const docs = [
  { kind: 'fo' as const, dir: 'fo', file: 'kumiori-xsl-fo.fo' },
  { kind: 'html' as const, dir: 'html', file: 'kumiori-html-css.html' },
  // 英語版 (見本は同じ。あれば同じく試す)
  { kind: 'fo' as const, dir: 'fo', file: 'kumiori-xsl-fo.en.fo' },
  { kind: 'html' as const, dir: 'html', file: 'kumiori-html-css.en.html' },
].filter((d) => fs.existsSync(path.join(root, d.dir, d.file)));

for (const d of docs) {
  const src = fs.readFileSync(path.join(root, d.dir, d.file), 'utf8');
  const samples: Sample[] = extractSamples(src, d.kind);
  const files = filesOf(d.dir);
  const run = (text: string) =>
    d.kind === 'fo' ? typesetFo(text, { loadFont, files, fonts: foFonts(), compat: 'spec' }) : typesetHtml(text, { loadFont, files, resolveResource, fetchStyles: false });

  describe(`対応仕様説明書 (${d.file})`, () => {
    it('見本がある (名前が重ならない)', () => {
      expect(samples.length).toBeGreaterThan(10);
    });
    for (const s of samples) {
      it(`見本 ${s.id} を組める`, async () => {
        const r = await run(standalone(s, d.kind));
        expect(r.warnings).toEqual([]);
        expect(r.areaTree.sheets.length).toBeGreaterThan(0);
      }, 60_000);
    }
    it('文書の全体を組める (コードの表示を差し込んだもの)', async () => {
      const full = expand(src, d.kind);
      const r = await run(full);
      expect(r.warnings).toEqual([]);
      expect(r.areaTree.sheets.length).toBeGreaterThan(10);
      const text = textOf(r.areaTree);
      // 見本ごとに、組版例の後にコードの表示が差し込まれ、組まれている (コードの 1 行目の始まりが字としてある)
      const flat = text.replace(/\s+/g, '');
      for (const s of samples) {
        expect(full).toContain(`id="code-${s.id}"`);
        const head = s.code.split('\n')[0].replace(/\s+/g, '').slice(0, 10);
        expect(flat, s.id).toContain(head);
      }
      // ページ番号の参照が解けている (未解決の印 ? が目次に残らない)
      expect(text).not.toMatch(/\.\.\.\?/);
    }, 120_000);
  });
}
