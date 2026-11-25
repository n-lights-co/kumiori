/**
 * update-fingerprints — 領域の木の指紋 (test/fingerprints/*.json) を、いまの組版の結果で書き直す (npm run fingerprints:update)。
 * 指紋を比べる試験 (test/conformance.test.ts・test/conformanceEn.test.ts・test/fingerprints.test.ts) を、KUMIORI_UPDATE_FINGERPRINTS=1 で走らせる (試験が、比べずにいまの指紋を書く)。
 * 意図して組版の結果を変えたときにだけ使う。書き直したら、git diff で変わった文書とページを見て、その理由と一緒にコミットの文に書く
 * (docs/development.md の「前と後の組み比べ」)
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const r = spawnSync(process.execPath, [vitest, 'run', 'test/conformance.test.ts', 'test/conformanceEn.test.ts', 'test/fingerprints.test.ts', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, KUMIORI_UPDATE_FINGERPRINTS: '1' },
});
process.exit(r.status ?? 1);
