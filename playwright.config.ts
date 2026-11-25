import os from 'node:os';
import { defineConfig } from '@playwright/test';
import { chromiumLaunchOptions } from './scripts/chromium.mjs';

/**
 * ブラウザでの結合テスト (e2e/)。画面を開いて、標準サンプルと XSL-FO の組版・PDF 出力が通ることを確かめる。
 * フォントは Google Fonts から取得する (KUMIORI_E2E_FONT_DIR を指定すると、そのディレクトリのフォントを使う。ファイルの名前は e2e/app.spec.ts の routeFonts の説明にある。
 * KUMIORI_E2E_FONT_CACHE を指定すると、取得したフォントをそのディレクトリに覚えておき、次からはそこから返す。e2e/fontCache.ts)。
 * KUMIORI_CHROMIUM に Chromium の実行ファイルを指すと、Playwright の取った Chromium ではなくそれを使う (比較のスクリプトと同じ。scripts/chromium.mjs)。
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  // 試験は互いに状態を分け合わない (試験ごとに別のページ) ので、ファイルの中の試験も並べて走らせる。ワーカーは CPU の数と、メモリ 1.5GB に 1 つの小さい方
  // (Playwright の既定は CPU の数の半分で、ファイルの中は 1 つずつ。4 つの CPU の機械で 136 秒 → 77 秒。docs/development.md の「確かめの時間」)
  fullyParallel: true,
  workers: Math.max(1, Math.min(os.availableParallelism(), Math.floor(os.totalmem() / (1.5 * 2 ** 30)))),
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5174', headless: true, launchOptions: chromiumLaunchOptions() },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
