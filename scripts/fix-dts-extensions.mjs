#!/usr/bin/env node
/**
 * 型の宣言 (.d.ts) の相対の参照に、拡張子 .js を付ける (npm run build:lib の最後に走る)。
 *
 *   node scripts/fix-dts-extensions.mjs dist-lib/types
 *
 * ソースは拡張子無しで import している (moduleResolution: Bundler) ので、tsc の出す宣言も `from './api'` になる。
 * 利用者の moduleResolution が Node16・NodeNext のとき、ES モジュール (package.json が "type": "module") の相対の import は
 * 拡張子を省けない (TypeScript の手引き「Modules - Reference」の node16・nodenext の節。誤り TS2834)。利用者が skipLibCheck: true だと、
 * 誤りは出ないまま、解決できなかった型が any になる。宣言の出力だけを直し、ソースの import は変えない。
 *
 * `./x` は、`x.d.ts` があれば `./x.js`、`x/index.d.ts` があれば `./x/index.js` にする。どちらも無ければ、誤りで終わる (ビルドを止める)。
 * 見るのは `from '…'`・`import '…'`・`import('…')` の、`./`・`../` で始まる参照だけ
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('使い方: node scripts/fix-dts-extensions.mjs <型の宣言のディレクトリ>');
  process.exit(1);
}

const pattern = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]*)\2/g;
const missing = [];
let changed = 0;
for (const name of fs.readdirSync(dir, { recursive: true })) {
  if (!name.endsWith('.d.ts')) continue;
  const file = path.join(dir, name);
  const text = fs.readFileSync(file, 'utf8');
  const fixed = text.replace(pattern, (all, head, quote, spec) => {
    if (/\.(js|mjs|cjs|json)$/.test(spec)) return all;
    const target = path.resolve(path.dirname(file), spec);
    if (fs.existsSync(`${target}.d.ts`)) return `${head}${quote}${spec}.js${quote}`;
    if (fs.existsSync(path.join(target, 'index.d.ts'))) return `${head}${quote}${spec.replace(/\/$/, '')}/index.js${quote}`;
    missing.push(`${name}: ${spec}`);
    return all;
  });
  if (fixed !== text) {
    fs.writeFileSync(file, fixed);
    changed++;
  }
}
if (missing.length) {
  console.error(`型の宣言の参照の先がありません:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`型の宣言の相対の参照に .js を付けました (${changed} ファイル)`);
