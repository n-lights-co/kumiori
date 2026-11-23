/**
 * draw.io と mxGraph から移したコード (Apache License 2.0) の表示を見張る:
 *  - src/drawio の各ファイルの先頭の「元のソースの表示」(元のファイル・版・著作権表示・変更したことの表示) と、
 *    THIRD_PARTY_NOTICES.md の 13.1 節の表が、互いに合っていること (ファイルにあって表に無い・表にあってファイルに無い、が無い。版と著作権表示の文字が合う)
 *  - 表示を持たないファイルが、決まった一覧 (Kumiori で書いたファイル) だけであること (移したファイルを足して表示を忘れると落ちる)
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'src/drawio');

/**
 * draw.io と mxGraph のソースを移していない、Kumiori で書いたファイル (src/drawio の下の道)。
 * 1 つずつ中を読んで確かめたもの: 見分け (sniff)・選択肢の型 (options)・形式の受け口 (index・load)・小さな XML の読み取り (drawioXml)・
 * 圧縮を解く (inflate。pako を呼ぶ)・base64・警告の文の言語 (messages)・文字の幅 (drawioText。描く側の測り方か Helvetica の幅の見積もり)・
 * Node のコマンドの道具 (nodeFiles)・配布物の表示の文 (notice)・途中の和の表 (prefixSums)。
 * ここにファイルを足すのは、そのファイルが draw.io と mxGraph のコードを含まないと確かめたときだけ
 */
const OWN = ['base64.ts', 'drawioHashes.ts', 'drawioPin.ts', 'drawioText.ts', 'drawioXml.ts', 'index.ts', 'inflate.ts', 'load.ts', 'messages.ts', 'nodeFiles.ts', 'notice.ts', 'options.ts', 'prefixSums.ts', 'sniff.ts'];

const SHAPES = 'v24.7.5';
const OTHERS = 'v32.6.10';

/** src/drawio の下の .ts (道は src/drawio からの相対。区切りは /) */
const files = (d = dir): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.relative(dir, path.join(d, e.name)).split(path.sep).join('/')] : []));

interface Entry {
  /** 元のファイル (src/main/webapp/ の下の道) */
  file: string;
  version: string | undefined;
  /** 著作権表示 (無いときは空) */
  notices: string[];
}

/** ファイルの先頭の「元のソースの表示」を読む。無ければ undefined */
function headerOf(rel: string): Entry[] | undefined {
  // Windows の git (core.autocrlf) は CRLF で取り出すので、LF に揃えてから行に分ける
  const src = fs.readFileSync(path.join(dir, rel), 'utf8').replace(/\r\n/g, '\n');
  const head = src.slice(0, src.indexOf('*/') + 2);
  const at = head.indexOf('元のソースの表示');
  if (at < 0) return undefined;
  const lines = head.slice(at).split('\n').map((l) => l.replace(/^\s*\*\s?/, ''));
  // 1 行目: どの版から移したか (「v32.6.10」か「shapes/ の下は v24.7.5、そのほかは v32.6.10」か「shapes/ の下は v24.7.5」)
  const ver = /^元のソースの表示 \(Apache License 2\.0 の 4 項 \(b\)・\(c\)\): このファイルは、draw\.io \(https:\/\/github\.com\/jgraph\/drawio。(.+)\) の$/.exec(lines[0]);
  expect(ver, `${rel}: 表示の 1 行目の形`).not.toBeNull();
  const split = /^(?:shapes\/ の下は (v[\d.]+)、そのほかは (v[\d.]+)|shapes\/ の下は (v[\d.]+)|(v[\d.]+))$/.exec(ver![1]);
  expect(split, `${rel}: 表示の版の書き方 ${ver![1]}`).not.toBeNull();
  // 「shapes/ の下は …」だけのときは、shapes/ の外のファイルの版は無い (undefined。表と合わずに落ちる)
  const versionOf = (file: string) => (split![4] ?? (file.startsWith('shapes/') ? (split![1] ?? split![3]) : split![2]));
  expect(lines[1], `${rel}: 書き直したことの表示`).toBe('次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。');
  expect(lines[2], `${rel}: 変更したことの表示`).toBe('Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:');
  const entries: Entry[] = [];
  let k = 3;
  for (; k < lines.length && lines[k].startsWith('  '); k++) {
    const m = /^ {2}(\S+): (.+)$/.exec(lines[k]);
    expect(m, `${rel}: 表示の行 ${lines[k]}`).not.toBeNull();
    const notices = m![2] === '(元のファイルに著作権表示は無い)' ? [] : m![2].split('; ');
    entries.push({ file: m![1], version: versionOf(m![1]), notices });
  }
  expect(lines[k], `${rel}: ライセンスの表示`).toBe('Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。');
  expect(entries.length, `${rel}: 元のファイルの一覧`).toBeGreaterThan(0);
  return entries;
}

/** THIRD_PARTY_NOTICES.md の 13.1 節の表 */
function table(): Array<Entry & { kumiori: string[] }> {
  const text = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8').replace(/\r\n/g, '\n');
  const sec = text.slice(text.indexOf('### 13.1 '), text.indexOf('### 13.2 '));
  const rows = sec.split('\n').filter((l) => l.startsWith('| `'));
  expect(rows.length).toBeGreaterThan(0);
  return rows.map((l) => {
    const c = l.split(' | ').map((s) => s.replace(/^\| |\s\|$/g, ''));
    expect(c, `表の行 ${l}`).toHaveLength(4);
    const file = /^`src\/main\/webapp\/(.+)`$/.exec(c[0])![1];
    const notices = c[2] === '(無い)' ? [] : c[2].split('<br>').map((s) => /^`(.+)`$/.exec(s)![1]);
    const kumiori = c[3].split('・').map((s) => /^`(.+)`$/.exec(s)![1]);
    return { file, version: c[1], notices, kumiori };
  });
}

describe('draw.io と mxGraph から移したコードの表示', () => {
  const all = files();
  const headers = new Map(all.map((f) => [f, headerOf(f)] as const));

  it('表示を持たないファイルは、Kumiori で書いたファイルの一覧のものだけ (一覧のファイルは表示を持たない)', () => {
    expect(all.filter((f) => !headers.get(f)).sort()).toEqual([...OWN].sort());
  });

  it('各ファイルの表示と、THIRD_PARTY_NOTICES.md の 13.1 節の表が合う (元のファイル・版・著作権表示・移した先)', () => {
    const rows = table();
    const byFile = new Map(rows.map((r) => [r.file, r]));
    expect(byFile.size, '表の行が重なっていない').toBe(rows.length);
    // ファイルの表示の 1 つずつが、表の行と合う
    for (const [rel, entries] of headers) {
      for (const e of entries ?? []) {
        const row = byFile.get(e.file);
        expect(row, `${rel} の ${e.file} が表に無い`).toBeDefined();
        expect(row!.version, `${rel} の ${e.file} の版`).toBe(e.version);
        expect(row!.version, `${e.file} の版 (shapes/ の下は ${SHAPES}、そのほかは ${OTHERS})`).toBe(e.file.startsWith('shapes/') ? SHAPES : OTHERS);
        expect(row!.notices, `${rel} の ${e.file} の著作権表示`).toEqual(e.notices);
        expect(row!.kumiori, `表の ${e.file} の行に ${rel} が無い`).toContain(rel);
      }
    }
    // 表の行の移した先のファイルが、どれもその元のファイルを表示に書いている
    for (const r of rows)
      for (const rel of r.kumiori) {
        const entries = headers.get(rel);
        expect(entries, `表の ${r.file} の行の ${rel} が無いか、表示を持たない`).toBeDefined();
        expect(entries!.map((e) => e.file), `表の ${r.file} の行の ${rel} の表示に、その元のファイルが無い`).toContain(r.file);
      }
  });
});
