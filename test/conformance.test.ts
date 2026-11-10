/**
 * 対応仕様説明書 (docs/conformance) の見本を、1 つずつテストとして組む。
 * 見本は文書の中の <?kumiori-sample?> (FO)・<!--kumiori-sample--> (HTML) の印の間に一度だけ書かれている (scripts/conformance-lib.mjs)。
 * 確かめること: 例外を出さずに組めること、警告 (読めない画像・知らない要素など) が出ないこと、中身の字が紙面にあること。
 * 文書の全体も組んで、ページ番号の参照・しおりの飛び先が解けていることを確かめる。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetFo, typesetHtml, walkAreaTree, type FontSpec, type GlyphArea } from '../src/index';
// @ts-expect-error 型の無い JavaScript のモジュール
import { expand, extractSamples, standalone } from '../scripts/conformance-lib.mjs';
import { ensureFonts, fontDir } from './helpers';

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

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 120_000);

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
  const run = (text: string) => (d.kind === 'fo' ? typesetFo(text, { loadFont, files, compat: 'spec' }) : typesetHtml(text, { loadFont, files }));

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
