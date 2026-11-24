#!/usr/bin/env node
/**
 * 続きから組む作りの確かめ (design/resumable-flow.md の 4.4): 手元の見本を、1 段の page-sequence の続きから組める境目のすべてで、
 * 1 ページ先まで組んでから境目に戻り、境目の写しから続けて組む器 (resume) で組み、使い回さない器 (reuse: false) で組んだものと、
 * 領域の木・診断 (場所まで)・警告・PDF のバイト列が同じで、戻って同じ境目に来たときの指紋が同じことを確かめる。
 * 文書ごとに、写した境目・続きから組めた境目・続けた回数・続けられない理由ごとの数 (設計の 2.4) を出す。
 *
 * 使い方: node scripts/check-resume.mjs [scripts/check-relayout.mjs の引数]
 *   scripts/check-relayout.mjs を --subjects resume --edits 0 で走らせる (群・--filter・--jobs・--json などは、そちらと同じ)。
 *   --edits N を渡すと、直した版でも試す。--late [N] で、器 resume-late (page-sequence を終わりまで組んだ後、境目を N 個ほど選んで、
 *   後ろから順に、境目に戻って終わりまで組み直す。既定 4) で試す。速い版 (小さな文書) は test/resume.test.ts で、npm test に入っている
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rest = process.argv.slice(2);
const li = rest.indexOf('--late');
if (li >= 0) {
  const n = rest[li + 1] && /^\d+$/.test(rest[li + 1]) ? rest[li + 1] : '4';
  rest.splice(li, /^\d+$/.test(rest[li + 1] ?? '') ? 2 : 1, '--subjects', 'resume-late', '--late', n);
}
const pass = [...(rest.includes('--edits') ? [] : ['--edits', '0']), ...(rest.includes('--subjects') ? [] : ['--subjects', 'resume']), ...rest];
const r = spawnSync(process.execPath, [path.join(here, 'check-relayout.mjs'), ...pass], { stdio: 'inherit' });
process.exitCode = r.status ?? 1;
