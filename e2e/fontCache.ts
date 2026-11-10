/**
 * e2e の書体のキャッシュ: ブラウザが Google Fonts の配信元 (fonts.gstatic.com) から取る書体を、ディレクトリに覚えておく。
 * 環境変数 KUMIORI_E2E_FONT_CACHE にディレクトリを指定すると、そこにあるファイルはネットワークに行かずに返し、
 * 無いファイルは配信元から取って、返すとともにそこへ保存する (次からはそこから返す)。
 * CI は、このディレクトリを actions/cache で持ち越す (.github/workflows/ci.yml の e2e。毎回 配信元から取り直さない)。
 * KUMIORI_E2E_FONT_DIR (手元に用意した書体だけで走らせる。ネットワークの無い環境用) を指定したときは、そちらが先 (ここは何もしない)
 */
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const TYPES: Record<string, string> = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };

export async function routeFontCache(page: Page): Promise<void> {
  const dir = process.env.KUMIORI_E2E_FONT_CACHE;
  if (!dir || process.env.KUMIORI_E2E_FONT_DIR) return;
  await page.route('**/fonts.gstatic.com/**', async (route) => {
    const url = new URL(route.request().url());
    // ファイルの名前は、URL のパス (書体・版・ファイルの名前) を 1 つの名前にしたもの (ディレクトリの区切り・ほかの記号は _ に)。
    // 問い合わせの付いた URL (字を絞った書体など) は、覚えずにそのまま通す
    const type = TYPES[path.extname(url.pathname).toLowerCase()];
    if (route.request().method() !== 'GET' || url.search || !type) return route.continue();
    const file = path.join(dir, url.pathname.replace(/^\/+/, '').replace(/[^\w.-]/g, '_'));
    if (fs.existsSync(file)) return route.fulfill({ body: fs.readFileSync(file), contentType: type, headers: { 'access-control-allow-origin': '*' } });
    const res = await route.fetch();
    if (res.ok()) {
      // 書きかけのファイルを、ほかのテスト (ワーカー) が読まないように、一時ファイルに書いてから名前を変える
      const body = await res.body();
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, file);
    }
    return route.fulfill({ response: res });
  });
}
