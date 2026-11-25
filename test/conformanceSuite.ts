/**
 * 対応仕様説明書 (docs/conformance) の見本を、1 つずつテストとして組む試験の部品。文書ごとの試験のファイル
 * (test/conformanceXslFo.test.ts・conformanceXslFoEn.test.ts・conformanceHtmlCss.test.ts・conformanceHtmlCssEn.test.ts) が、文書を 1 つずつ渡して呼ぶ
 * (vitest はファイルごとに別のワーカーで並べて走らせるので、4 冊を並べて組める。1 つのファイルの中の試験は、書いた順に 1 つずつ走る)。
 * 見本は文書の中の <?kumiori-sample?> (FO)・<!--kumiori-sample--> (HTML) の印の間に一度だけ書かれている (scripts/conformance-lib.mjs)。
 * 確かめること: 例外を出さずに組めること、警告 (読めない画像・知らない要素など) が出ないこと、中身の字が紙面にあること。
 * 文書の全体も組んで、ページ番号の参照・しおりの飛び先が解けていることを確かめる。
 * 言語ごとの見本・絵文字の見本・可変フォントの見本の書体 (既定の書体に無い字・機能) は、scripts/conformance-fonts.mjs の一覧のもの。
 * 置き場 (.cache/fonts) に取得して (取得できなければ失敗する)、HTML には @font-face の URL の中身として (resolveResource)、XSL-FO には fonts で渡す。
 * テストの中からは、ネットワークへ書体を取りに行かせない (fetchStyles: false。一覧に無い URL を見本に書くと、警告が出て失敗する)。
 * 見本と文書の全体の領域の木の指紋を、文書ごとの test/fingerprints/conformance-<文書>.json と比べる (test/fingerprint.ts。組版の結果が変わったら気づく。
 * 意図して変えたときは npm run fingerprints:update で書き直す)。見本の書体の一覧の確かめは test/conformance.test.ts にある
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetFo, typesetHtml, walkAreaTree, type FontSpec, type GlyphArea } from '../src/index';
// @ts-expect-error 型の無い JavaScript のモジュール
import { expand, extractSamples, standalone } from '../scripts/conformance-lib.mjs';
// @ts-expect-error 型の無い JavaScript のモジュール
import { CONFORMANCE_FONTS } from '../scripts/conformance-fonts.mjs';
import { cachedFont, ensureFonts, fontDir } from './helpers';
import { fingerprintStore, updatingFingerprints } from './fingerprint';

type Sample = { id: string; raw: string; code: string };

export const root = path.resolve(import.meta.dirname, '..', 'docs', 'conformance');
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
  for (const f of fs.readdirSync(path.join(root, dir, 'images')))
    out.push({
      name: `images/${f}`,
      data: fs.readFileSync(path.join(root, dir, 'images', f)),
    });
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
export const sampleFonts: SampleFont[] = CONFORMANCE_FONTS;
export const sampleFontByUrl = new Map(sampleFonts.map((f) => [f.url, f]));
/** HTML の @font-face が指す配信元の URL の中身を、置き場のファイルから返す (一覧に無い参照は undefined) */
const resolveResource = (url: string) => {
  const f = sampleFontByUrl.get(url);
  return f ? new Uint8Array(fs.readFileSync(path.join(fontDir, f.file))) : undefined;
};
/** XSL-FO に渡す書体 (コマンドの --font と同じ) */
const foFonts = () =>
  sampleFonts
    .filter((f) => f.fo)
    .map((f) => ({
      name: f.file,
      data: new Uint8Array(fs.readFileSync(path.join(fontDir, f.file))),
    }));

type ConformanceDoc = { kind: 'fo' | 'html'; dir: string; file: string };

/**
 * 対応仕様説明書の試験 (文書ごとに、見本の 1 つずつと文書の全体)。指紋は test/fingerprints/<store>.json に置く
 * (ファイルごとに分ける。並んで走る試験のファイルが、同じ指紋のファイルを書かないように)
 */
export function conformanceSuite(list: readonly ConformanceDoc[], store: string): void {
  beforeAll(async () => {
    await ensureFonts(DEFAULT_FONTS.base);
    await Promise.all(sampleFonts.map((f) => cachedFont(f.file, f.url)));
  }, 300_000);

  /** 領域の木の指紋 (見本は <文書>#<見本の名前>、文書の全体は <文書>) */
  const fingerprints = fingerprintStore(store);
  // 文書が無ければ試さない (英語版など)
  for (const d of list.filter((x) => fs.existsSync(path.join(root, x.dir, x.file)))) {
    const src = fs.readFileSync(path.join(root, d.dir, d.file), 'utf8');
    const samples: Sample[] = extractSamples(src, d.kind);
    const files = filesOf(d.dir);
    const run = (text: string) =>
      d.kind === 'fo'
        ? typesetFo(text, { loadFont, files, fonts: foFonts(), compat: 'spec' })
        : typesetHtml(text, {
            loadFont,
            files,
            resolveResource,
            fetchStyles: false,
          });

    describe(`対応仕様説明書 (${d.file})`, () => {
      it('見本がある (名前が重ならない)', () => {
        expect(samples.length).toBeGreaterThan(10);
      });
      for (const s of samples) {
        fingerprints.expect(`${d.file}#${s.id}`);
        it(`見本 ${s.id} を組める`, async () => {
          const r = await run(standalone(s, d.kind));
          expect(r.warnings).toEqual([]);
          expect(r.areaTree.sheets.length).toBeGreaterThan(0);
          expect(fingerprints.check(`${d.file}#${s.id}`, r.areaTree)).toBeUndefined();
        }, 60_000);
      }
      fingerprints.expect(d.file);
      it('文書の全体を組める (コードの表示を差し込んだもの)', async () => {
        const full = expand(src, d.kind);
        const r = await run(full);
        expect(r.warnings).toEqual([]);
        expect(r.areaTree.sheets.length).toBeGreaterThan(10);
        expect(fingerprints.check(d.file, r.areaTree)).toBeUndefined();
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

  // 試験の終わりに (同じファイルの試験は、書いた順に 1 つずつ走る): 書き直すときは指紋を書き、比べるときは、指紋のファイルに、もう組まない文書が残っていないことを確かめる
  it(`指紋のファイル (test/fingerprints/${store}.json) に、組まなかった文書が無い`, () => {
    expect(fingerprints.finish(), updatingFingerprints ? '指紋を書けなかった文書があります' : '消した見本・文書の指紋が残っています。npm run fingerprints:update で書き直す').toEqual([]);
  });
  // 書き直すときは、上の試験が絞り (-t) で飛ばされても書く
  afterAll(() => {
    if (updatingFingerprints) fingerprints.finish();
  });
}
