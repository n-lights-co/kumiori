#!/usr/bin/env node
/**
 * 変更の記録 (CHANGELOG.md・CHANGELOG.en.md) の「未公開」の節に書くべき変更の候補を並べる。
 *
 *   node scripts/changelog-unreleased.mjs [--since <コミット>]
 *
 * 前の版を上げたコミット (package.json の "version" の行を変えた最後のコミット。--since で替えられる) から HEAD までのコミットのうち、
 * 次のものを並べる。並べたものを読んで、未公開の節に項目があるか (組版の結果が変わる・互換が変わるなどの断りも) を人が確かめる。
 *  - src を変えたのに、CHANGELOG.md も CHANGELOG.en.md も変えていないコミット
 *    (試験・文書だけの直しなど、書かなくてよいものもある。項目を後のコミットでまとめて書いたものもある)
 *  - CHANGELOG.md と CHANGELOG.en.md の片方だけを変えたコミット (日英のどちらかの直し忘れの候補)
 * 項目が要るかは、変更の中身で決まるので、試験にはせず、読み直しの確かめに使う (docs/development.md の「読み直しの確かめ」)。
 * 終了の状態は、候補があっても 0 (git が動かないとき・前の版のコミットが見つからないときは 1)。
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const si = args.indexOf('--since');
if (args.some((a, k) => a !== '--since' && k !== si + 1) || (si >= 0 && !args[si + 1])) {
  console.error('使い方: node scripts/changelog-unreleased.mjs [--since <コミット>]');
  process.exit(1);
}
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

let since = si >= 0 ? args[si + 1] : '';
if (!since) {
  since = git('log', '-1', '--format=%H', '-G', '"version":', '--', 'package.json');
  if (!since) {
    console.error('前の版を上げたコミット (package.json の "version" を変えたもの) が見つかりません。浅い clone なら git fetch --unshallow するか、--since で渡してください');
    process.exit(1);
  }
}
console.log(`範囲: ${git('log', '-1', '--format=%h %s', since)} の後から HEAD まで\n`);

const commits = git('log', '--reverse', '--format=%H', `${since}..HEAD`).split('\n').filter(Boolean);
const noEntry = [];
const oneSide = [];
for (const c of commits) {
  const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', c).split('\n');
  const ja = files.includes('CHANGELOG.md');
  const en = files.includes('CHANGELOG.en.md');
  const line = git('log', '-1', '--format=%h %s', c);
  if (files.some((f) => f.startsWith('src/')) && !ja && !en) noEntry.push(line);
  if (ja !== en) oneSide.push(`${line} (${ja ? 'CHANGELOG.md' : 'CHANGELOG.en.md'} だけ)`);
}
console.log(`src を変えて、変更の記録を変えていないコミット (${noEntry.length} 件。未公開の節に項目があるかを確かめる):`);
for (const l of noEntry) console.log(`  ${l}`);
console.log(`\n変更の記録の日英の片方だけを変えたコミット (${oneSide.length} 件):`);
for (const l of oneSide) console.log(`  ${l}`);
