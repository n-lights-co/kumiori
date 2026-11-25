import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import SlowFirstSequencer from './test/sequencer';

export default defineConfig({
  // テストが import する 'kumiori' は、ビルドした配布物 (dist-lib) でなく、このリポジトリの src を指す
  resolve: { alias: [{ find: /^kumiori$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) }] },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // 同時に走らせるファイルの数: CPU の数と、メモリ 2.5GB に 1 つの小さい方 (vitest の既定は CPU の数 − 1。試験の多くは組版で CPU を使い切るので、
    // 主のプロセスのために 1 つ空けるより、CPU の数だけ走らせるほうが速い (時間は docs/development.md の「確かめの時間」)。
    // メモリの少ない機械で、重い試験 (対応仕様説明書の全体を組むもの) のワーカーが重なって足りなくならないように、メモリでも抑える)
    maxWorkers: Math.max(1, Math.min(os.availableParallelism(), Math.floor(os.totalmem() / (2.5 * 2 ** 30)))),
    // 時間のかかるファイルから先に走らせる (前の走りの覚えの無いときは test/durations.json の秒で見積もる。test/sequencer.ts)
    sequence: { sequencer: SlowFirstSequencer },
  },
});
