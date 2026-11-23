/**
 * 領域の木 (Area Tree) の指紋。組んだ結果の指紋を test/fingerprints/*.json に置いておき、組版の結果が変わったら npm test で気づけるようにする。
 *
 * 指紋は、serializeAreaTree と同じ JSON (JSON.stringify の木) の SHA-256。ただし、
 *  - 数は 1/1000 (pt) に丸める (計算の順が変わっただけの、目に見えない端数の違いでは変わらないように)
 *  - バイトの並び (画像のデータなど。Uint8Array など) は、その SHA-256 の 16 進にする (JSON を短くするため。中身が変われば指紋も変わる)
 * 文書の全体の指紋 (sha256) と、ページ (sheets の 1 枚) ごとの指紋 (pages) を持つ。ページの指紋で、どのページが変わったかが分かる。
 *
 * 意図して組版の結果を変えたときは、`npm run fingerprints:update` で書き直す (KUMIORI_UPDATE_FINGERPRINTS=1 で試験を走らせ、いまの指紋を書く)。
 * `npm run fingerprints:update -- -t <名前>` のように絞ると、組んだ文書の指紋だけを書き直し、ほかの文書の指紋は残す。
 * 書き直したら、変わった文書とページ (試験の失敗の文に出る) と、その理由を、コミットの文に書く (docs/development.md の「前と後の組み比べ」)
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AreaTree } from '../src/types';

export type Fingerprint = { sha256: string; pages: string[] };

const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

/** JSON にするときの置き換え: 数を丸め、バイトの並びを SHA-256 にする */
function replacer(_key: string, v: unknown): unknown {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
  if (ArrayBuffer.isView(v)) return `sha256:${sha256(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))}`;
  if (v instanceof ArrayBuffer) return `sha256:${sha256(new Uint8Array(v))}`;
  return v;
}

/** 領域の木の指紋 */
export function areaFingerprint(tree: AreaTree): Fingerprint {
  const pages = tree.sheets.map((s) => sha256(JSON.stringify(s, replacer)));
  // ページの外の欄 (しおり・文書の情報など) も入れる
  const rest = JSON.stringify({ ...tree, sheets: undefined }, replacer);
  return { sha256: sha256(`${rest}\n${pages.join('\n')}`), pages };
}

/** いまの指紋を書き直すか (npm run fingerprints:update) */
export const updatingFingerprints = process.env.KUMIORI_UPDATE_FINGERPRINTS === '1';

/**
 * 1 つの指紋のファイル (test/fingerprints/<name>.json) の記録。組む文書の名前を、試験を集めるときに expect ですべて知らせておき、
 * 試験ごとに check で比べ、最後に finish で、書き直すときはファイルに書き、比べるときは、ファイルにあるのにもう組まない文書が無いことを確かめる。
 * 書き直すときも、このたび組まなかった文書 (vitest の -t などで絞ったもの・check の前で落ちたもの) の指紋は、ファイルにあるものを残す。
 * ファイルから消すのは、expect で知らせなかった文書 (もう組まない文書) の指紋だけ
 */
export function fingerprintStore(name: string, opts: { dir?: string; update?: boolean } = {}) {
  const file = path.resolve(opts.dir ?? path.join(import.meta.dirname, 'fingerprints'), `${name}.json`);
  const update = opts.update ?? updatingFingerprints;
  const saved: Record<string, Fingerprint> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const now: Record<string, Fingerprint> = {};
  const expected = new Set<string>();
  let written = false;
  return {
    file,
    /** 組む文書の名前を知らせる (試験を集めるときに、絞りに関わらず、すべての文書について呼ぶ) */
    expect(key: string): string {
      expected.add(key);
      return key;
    },
    /** 指紋を比べる。違えば、変わったページ (1 から数える) とページ数を書いた文を返す (同じなら undefined)。書き直すときは控えるだけ */
    check(key: string, tree: AreaTree): string | undefined {
      const fp = areaFingerprint(tree);
      now[key] = fp;
      expected.add(key);
      if (update) return undefined;
      const old = saved[key];
      if (!old) return `${key}: 指紋がありません (新しく足した文書なら npm run fingerprints:update で書く)`;
      if (old.sha256 === fp.sha256) return undefined;
      const changed: number[] = [];
      for (let i = 0; i < Math.max(old.pages.length, fp.pages.length); i++) if (old.pages[i] !== fp.pages[i]) changed.push(i + 1);
      return (
        `${key}: 組版の結果が変わりました (ページ数 ${old.pages.length} → ${fp.pages.length}。変わったページ: ${changed.length ? changed.join('・') : 'なし (ページの外の欄)'})。` +
        '意図した変更なら npm run fingerprints:update で書き直し、変わった文書とページと理由をコミットの文に書く'
      );
    },
    /**
     * 書き直すときはファイルに書き (このたび組んだ文書は新しい指紋、組まなかった文書はファイルにある指紋)、指紋の無いままの文書の名前を返す。
     * 比べるときは、ファイルにあって、もう組まない (expect で知らせなかった) 文書の名前を返す (ファイルから消すべきもの)。
     * 何度呼んでもよい (書き直すのは 1 度だけ)
     */
    finish(): string[] {
      if (update) {
        const keys = [...expected].sort();
        const missing = keys.filter((k) => !now[k] && !saved[k]);
        if (!written) {
          written = true;
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const out = Object.fromEntries(keys.filter((k) => now[k] ?? saved[k]).map((k) => [k, now[k] ?? saved[k]]));
          fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
          const kept = keys.filter((k) => !now[k] && saved[k]).length;
          if (kept) console.info(`${path.basename(file)}: このたび組まなかった ${kept} 文書の指紋は、前のまま残しました`);
        }
        return missing;
      }
      return Object.keys(saved).filter((k) => !expected.has(k));
    },
  };
}
