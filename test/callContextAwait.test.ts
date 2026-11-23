/**
 * 呼び出しの道筋の await が、どれも rejoin(thisCall(), await …) の形であること (src/callContext.ts)。
 * AsyncLocalStorage の無い環境 (ブラウザ) では、await の後で呼び出しの文脈 (言語など) を置き直さないと、
 * 同時に走るほかの呼び出しの文脈のまま続きを走らせてしまう。書き忘れを、ここで拾う。
 * 対象の外: コマンド・画面・Node だけの部品 (AsyncLocalStorage がある)、モジュールの読み込みだけの所、callContext.ts・messages.ts そのもの
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(__dirname, '..', 'src');
const EXEMPT = new Set(['cli.ts', 'main.ts', 'epub.ts', 'nodeFonts.ts', 'index.ts', 'node.ts', 'messages.ts', 'callContext.ts', 'linkedomModules.ts', 'linkedomModules.browser.ts', 'drawio/nodeFiles.ts']);

function files(dir: string, base = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) return files(path.join(dir, e.name), rel);
    return /\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [rel] : [];
  });
}

describe('呼び出しの道筋の await', () => {
  it('どれも rejoin(thisCall(), await …) で、await の後に文脈を置き直す', () => {
    const bad: string[] = [];
    for (const rel of files(SRC)) {
      if (EXEMPT.has(rel)) continue;
      const lines = fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n');
      lines.forEach((line, k) => {
        // コメントの行と、行の後ろのコメントは見ない
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const code = line.replace(/\/\/.*$/, '');
        for (const m of code.matchAll(/\bawait\s+(?=[\w$([!`'"{.-])/g)) {
          if (!code.slice(0, m.index).endsWith('rejoin(thisCall(), ')) bad.push(`${rel}:${k + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});
