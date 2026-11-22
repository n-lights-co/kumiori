/**
 * drawio/nodeFiles — コマンド (cli.ts) の draw.io の選択肢のための、Node でだけ使う道具 (ファイルを読む・取ったものを手元に覚える)。
 *
 *   kumiori doc.html --drawio-stencils ./stencils --fetch-drawio-stencils
 *
 * --drawio-stencils <ファイルかディレクトリ>  図形ライブラリ (stencils.min.js かライブラリの XML) と配布物の画像 (.svg・.png・.jpg)。
 *                                            ディレクトリなら、その中 (下のディレクトリも) の .xml・.js・.svg・.png・.jpg。, で区切って何個でも
 * --fetch-drawio-stencils                    足りない図形ライブラリ・配布物の画像を draw.io の配布物から取るのを許す。
 *                                            取ったものは書体のキャッシュの場所に保存し、次からはネットワークに行かない
 * --drawio-stencils-url <URL>                取り先の stencils.min.js の URL (--fetch-drawio-stencils も付けたことになる)
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DrawioFile, DrawioStencilFetcher } from './options';
import { msgIn, type Lang } from './messages';

/** ディレクトリの中のファイル (下のディレクトリも。名前の順) */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** 図形ライブラリのファイル (コマンドの --drawio-stencils の , で区切った並び。無いものは誤り) */
export function stencilFiles(list: string, lang?: Lang): DrawioFile[] {
  const files: DrawioFile[] = [];
  for (const p of list.split(',').map((s) => s.trim()).filter(Boolean)) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new Error(msgIn(lang, `draw.io の図形ライブラリのファイルが見つかりません: ${p}`, `draw.io shape library file not found: ${p}`));
    const found = fs.statSync(abs).isDirectory() ? listFiles(abs).filter((f) => /\.(xml|js|svg|png|jpe?g)$/i.test(f)) : [abs];
    for (const f of found) files.push({ name: path.basename(f), data: async () => fs.readFileSync(f) });
  }
  return files;
}

/** 取ったものを cacheDir に保存して使い回す fetchStencils (cacheDir が無ければ、保存せずに取る) */
export function cachedFetcher(cacheDir: string | undefined, lang?: Lang): DrawioStencilFetcher {
  return async (p, { url, fetch }) => {
    const bundle = p.endsWith('stencils.min.js');
    const ext = bundle ? 'js' : (/\.(\w+)$/.exec(p)?.[1] ?? 'img').toLowerCase();
    const cached = cacheDir ? path.join(cacheDir, `drawio-${bundle ? 'stencils' : 'image'}-${createHash('sha256').update(url).digest('hex').slice(0, 16)}.${ext}`) : undefined;
    // 既定の取り先 (版を決めたタグの URL) のものは、版の SHA-256 の一覧と照らす (drawioPin.ts)。合わない覚えは使わずに取り直し、
    // 合わない中身は覚えない (呼ぶ側の load.ts も照らして、使わずに警告する)
    const { checkPinned } = await import('./drawioPin');
    const bad = (b: Uint8Array) => ['mismatch', 'unlisted'].includes(checkPinned(p, url, b));
    if (cached && fs.existsSync(cached)) {
      const b = fs.readFileSync(cached);
      if (!bad(b)) return b;
    }
    const got = await fetch(url);
    if (!got) return undefined;
    // 図形ライブラリ・画像と読めるものだけを保存する (誤りの応答の HTML などを覚えない)
    const { StencilRegistry, imageMime } = await import('./drawioStencil');
    if (cached && !bad(got) && (bundle ? new StencilRegistry().add(new TextDecoder().decode(got)) : imageMime(got))) {
      try {
        fs.mkdirSync(cacheDir!, { recursive: true });
        fs.writeFileSync(cached, got);
        if (bundle) console.error(msgIn(lang, `draw.io の図形ライブラリを保存しました: ${cached}`, `saved the draw.io shape libraries: ${cached}`));
      } catch (e) {
        console.error(msgIn(lang, `draw.io の図形ライブラリを保存できません: ${String(e instanceof Error ? e.message : e)}`, `could not save the draw.io shape libraries: ${String(e instanceof Error ? e.message : e)}`));
      }
    }
    return got;
  };
}
