/**
 * Chromium を起こすときの指定を、e2e (playwright.config.ts) と比較のスクリプト (compare-pdf.mjs・compare-css.mjs) でそろえる。
 *
 * 環境変数 KUMIORI_CHROMIUM に Chromium の実行ファイルを指すと、Playwright の取った Chromium ではなく、それを使う
 * (Playwright の版と、入っている Chromium の版が合わない環境のため。例: KUMIORI_CHROMIUM=/opt/pw-browsers/chromium)。
 * 指さないときは、いまどおり Playwright の取った Chromium を使う (空の指定を返す)。
 */
export function chromiumLaunchOptions(env = process.env) {
  const exe = env.KUMIORI_CHROMIUM?.trim();
  return exe ? { executablePath: exe } : {};
}
