/**
 * リポジトリの見本の文書 (examples・samples) の領域の木の指紋を、test/fingerprints/documents.json と比べる (test/fingerprint.ts)。
 * 組版の結果が変わったら気づくための試験。意図して変えたときは npm run fingerprints:update で書き直す。
 * 対応仕様説明書の指紋は test/conformance.test.ts が比べる (test/fingerprints/conformance.json)。
 * 書体は既定の書体 (.cache/fonts。無ければ 1 度だけ取得して置く。置いてあればネットワークを使わない)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FONTS, typesetFo, typesetHtml } from '../src/index';
import { ensureFonts, loadCachedFont } from './helpers';
import { fingerprintStore, updatingFingerprints } from './fingerprint';

const root = path.resolve(import.meta.dirname, '..');
const fingerprints = fingerprintStore('documents');

/** 文書と同じディレクトリのファイル (画像・図・CSS) を、組むときのファイルとして渡す */
const filesOf = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => !/\.(x?html?|fo|md)$/i.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .map((f) => ({ name: f, data: new Uint8Array(fs.readFileSync(path.join(dir, f))) }));

type Doc = { file: string; compat?: 'spec' | 'antenna' };
const docs: Doc[] = [
  { file: 'examples/drawio-pages/pages.html' },
  { file: 'examples/drawio-pages/pages.fo' },
  // 自作の確かめの見本は、仕様どおりのモードと互換のモードの両方で組む (samples/check/README.md)
  ...fs
    .readdirSync(path.join(root, 'samples/check/fo'))
    .filter((f) => f.endsWith('.fo'))
    .sort()
    .flatMap((f): Doc[] => [
      { file: `samples/check/fo/${f}`, compat: 'spec' },
      { file: `samples/check/fo/${f}`, compat: 'antenna' },
    ]),
];

beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

describe('見本の文書の領域の木の指紋 (test/fingerprints/documents.json)', () => {
  for (const d of docs) {
    const key = fingerprints.expect(d.compat ? `${d.file} (--compat ${d.compat})` : d.file);
    it(key, async () => {
      const file = path.join(root, d.file);
      const text = fs.readFileSync(file, 'utf8');
      const opts = { loadFont: loadCachedFont, files: filesOf(path.dirname(file)) };
      const r = d.file.endsWith('.fo') ? await typesetFo(text, { ...opts, compat: d.compat ?? 'spec' }) : await typesetHtml(text, { ...opts, fetchStyles: false });
      expect(r.areaTree.sheets.length).toBeGreaterThan(0);
      expect(fingerprints.check(key, r.areaTree)).toBeUndefined();
    });
  }
  it('指紋のファイルに、組まなかった文書が無い', () => {
    expect(fingerprints.finish(), updatingFingerprints ? '指紋を書けなかった文書があります' : '消した文書の指紋が残っています。npm run fingerprints:update で書き直す').toEqual([]);
  });
});
// 書き直すときは、上の試験が絞り (-t) で飛ばされても書く
afterAll(() => {
  if (updatingFingerprints) fingerprints.finish();
});
