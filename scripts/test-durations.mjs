#!/usr/bin/env node
/**
 * test-durations — vitest の JSON の報告から、時間のかかる試験のファイルの秒を test/durations.json に書く
 * (npm test の走らせる順を決める test/sequencer.ts が読む。順を決めるためだけのもので、古くなっても試験の結果は変わらない)。
 *
 * 使い方 (リポジトリの直下で):
 *   npx vitest run --reporter=default --reporter=json --outputFile.json=<報告.json>
 *   node scripts/test-durations.mjs <報告.json> [--min <秒>]
 *  - --min: 書くファイルの下限の秒 (既定 5)。それより短いファイルは書かない (既定の順 (大きさの順) で、見積もったファイルの後ろに走る)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
let min = 5;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--min') min = Number(argv[++i]);
  else files.push(argv[i]);
}
if (files.length !== 1 || !(min >= 0)) {
  console.error('使い方: node scripts/test-durations.mjs <vitest の JSON の報告> [--min <秒>]');
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(files[0], 'utf8'));
const testDir = path.join(root, 'test');
const seconds = {};
for (const t of report.testResults ?? []) {
  const sec = (t.endTime - t.startTime) / 1000;
  if (!(sec >= min)) continue;
  seconds[path.relative(testDir, t.name).split(path.sep).join('/')] = Math.round(sec);
}
const sorted = Object.fromEntries(Object.entries(seconds).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)));
const out = {
  description: 'npm test の試験のファイルの、測った秒 (test/sequencer.ts が、前の走りの覚えの無いファイルを、時間のかかる順に走らせるために読む)。書き直しは node scripts/test-durations.mjs <vitest の JSON の報告>',
  seconds: sorted,
};
fs.writeFileSync(path.join(testDir, 'durations.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`test/durations.json に ${Object.keys(sorted).length} ファイルを書きました (${min} 秒以上)`);
