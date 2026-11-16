import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // テストが import する 'kumiori' は、ビルドした配布物 (dist-lib) でなく、このリポジトリの src を指す
  resolve: { alias: [{ find: /^kumiori$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) }] },
  test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 300_000 },
});
