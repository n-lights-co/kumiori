import { defineConfig } from '@playwright/test';

/**
 * ブラウザでの結合テスト (e2e/)。画面を開いて、標準サンプルと XSL-FO の組版・PDF 出力が通ることを確かめる。
 * フォントは Google Fonts から取得する (KUMIORI_E2E_FONT_DIR を指定すると、そのディレクトリのフォントを使う。
 * KUMIORI_E2E_FONT_CACHE を指定すると、取得したフォントをそのディレクトリに覚えておき、次からはそこから返す。e2e/fontCache.ts)。
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5174', headless: true },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
