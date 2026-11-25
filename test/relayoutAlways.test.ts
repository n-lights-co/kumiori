/**
 * 組み直しの再利用の確かめ (速い組): リポジトリの代表の文書と、種を決めた乱数の文書 (scripts/gen-stress-docs.mjs) で、
 *  - createTypesetter の使い回し (reuse) と、前の組版と揃った境目で繋ぐ所の確かめ (splice-verify): 種を決めた乱数の所で直しながら組む
 *  - 続きから組む作り (resume: 境目のすべてで 1 ページ先まで組んでから戻る) と、遅く戻る試し (resume-late: 終わりまで組んだ後に、前の境目から組み直す)
 * の結果 (領域の木・診断・警告・PDF のバイト列) が、初めから使い回さずに組んだ結果と同じこと、境目の指紋と繋ぐ確かめに違いが無いことを確かめる。
 * 確かめの中身は scripts/check-relayout.mjs と同じ (部品は scripts/relayout-check-lib.mjs)。リポジトリの文書の全部は、
 * npm run ci:local の relayout のジョブで、check-relayout.mjs・check-resume.mjs で確かめる
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTypesetter, DEFAULT_FONTS, serializeAreaTree } from '../src/index';
import { resumeProbe } from '../src/layoutEngine';
import { ensureFonts, loadCachedFont } from './helpers';
import { checkRelayout, editSequence, probeFailures, probeSubjects } from '../scripts/relayout-check-lib.mjs';
import { RESUME_SHAPES, REUSE_SHAPES } from '../scripts/gen-stress-docs.mjs';

const root = path.resolve(import.meta.dirname, '..');
const lib = { createTypesetter, serializeAreaTree } as never;

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

/** 確かめる文書 (名前・文字列・文書ごとの設定) */
function docs() {
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
  const drawio = new Uint8Array(fs.readFileSync(path.join(root, 'examples/drawio-pages/diagrams.drawio')));
  const files = () => [{ name: 'diagrams.drawio', data: drawio.slice() }];
  return [
    { name: 'examples/drawio-pages/pages.html', text: read('examples/drawio-pages/pages.html'), options: () => ({ kind: 'html', files: files() }) },
    { name: 'examples/drawio-pages/pages.fo', text: read('examples/drawio-pages/pages.fo'), options: () => ({ kind: 'fo', files: files() }) },
    { name: 'samples/check/fo/indent-inheritance-1.fo', text: read('samples/check/fo/indent-inheritance-1.fo'), options: { kind: 'fo', compat: 'spec' } },
    // 罫線をつぶした表がページをまたぐ文書 (HTML と、最後のページのマスターのある XSL-FO)
    { name: 'gen:collapsetable', resumes: true, text: RESUME_SHAPES.collapsetable.make(3), options: { kind: 'html' } },
    { name: 'gen:focollapsetable', resumes: true, text: RESUME_SHAPES.focollapsetable.make(3), options: { kind: 'fo' } },
    // 章ごとに page-sequence を分け、脚注・マーカーのある XSL-FO (page-sequence の使い回し)
    { name: 'gen:fofootnotes', resumes: true, text: REUSE_SHAPES.fofootnotes.make(4), options: { kind: 'fo' } },
    { name: 'gen:fomarkers', resumes: true, text: REUSE_SHAPES.fomarkers.make(4), options: { kind: 'fo' } },
  ];
}

describe('組み直しの再利用の確かめ (代表の文書)', () => {
  const subjects = probeSubjects(resumeProbe, { late: 4 });
  for (const d of docs()) {
    it(`${d.name}: 使い回しと繋ぐ所 (reuse・splice-verify)`, async () => {
      const versions = editSequence(d.text, { seed: 5, edits: 2, attrRate: 0.2, masterRate: 0.15 });
      const r = await checkRelayout({ lib, setup: { loadFont: loadCachedFont }, options: d.options, versions, subjects: [{ name: 'reuse' }, subjects['splice-verify']] });
      expect(probeFailures(r.versions)).toEqual([]);
    }, 120_000);
    it(`${d.name}: 続きから組む・遅く戻る (resume・resume-late)`, async () => {
      const r = await checkRelayout({ lib, setup: { loadFont: loadCachedFont }, options: d.options, versions: [{ text: d.text, label: '元の文書' }], subjects: [subjects.resume, subjects['resume-late']] });
      expect(probeFailures(r.versions)).toEqual([]);
      // 境目から続けて組んだこと (続けられる境目の無い文書では、確かめにならない)
      if ('resumes' in d) for (const x of r.versions[0].subjects) expect((x.stats as { resume: { resumed: number } }).resume.resumed, x.name).toBeGreaterThan(0);
    }, 120_000);
  }
});
