/**
 * THIRD_PARTY_NOTICES.md (第三者のソフトウェアの表示) が、package-lock.json で入る依存と食い違っていないかを見るテスト。
 * 依存の版が上がった (Dependabot など) のに表示を直し忘れることを防ぐ。docs/RELEASING.md の「公開の前の確かめ」の手作業のうち、
 * ビルドの要らないものをここで見る (ブラウザ向けのビルドに取り込まれたパッケージと 1 節の照合は、RELEASING.md の手順で見る)。
 *  - 実行時の依存 (package.json の dependencies から、package-lock.json で依存の木をたどったもの) のすべてに、同じ名前・同じ版の節 (`### 名前 版`) があり、
 *    その逆に、節のある版のパッケージが package-lock.json にある
 *  - 節の「package.json の license」が、package-lock.json の license と同じ
 *  - 「`node_modules/…` の本文:」として転記したライセンスの本文が、そのファイルの中身と同じ (書き換えずに転記している)
 *  - 1.6 節 (バンドラーが出力に書き込む手助けのコード) の見出しの版と「package.json の license」が、package-lock.json の開発の依存と同じ。
 *    「`node_modules/…` の初めの…部分」として転記した本文が、そのファイルの初めと同じ
 * node_modules は `npm ci` で入っている前提 (ほかのテストと同じ)
 *
 * 14 節 (GitHub Pages の API の説明書に入る、TypeDoc の頁のもの) は、tools/api-docs/package-lock.json と照らし合わせる:
 *  - 節 (`### 14.N 名前 (版)`) の版と「package.json の license」が、tools/api-docs/package-lock.json のものと同じ
 *  - 「`tools/api-docs/node_modules/…` の本文:」として転記した本文が、そのファイルの中身と同じ (tools/api-docs に依存が入っているとき
 *    (npm run docs:api の後) だけ。入っていなければ飛ばす)
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string; license?: string; dev?: boolean; link?: boolean; dependencies?: Record<string, string> }>;
};

/** コードの囲み (``` の行) の中かどうかを行ごとに返す。転記した README の中の見出し (## License など) を、文書の見出しと取り違えないため */
function insideFence(lines: string[]): boolean[] {
  const out: boolean[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const m = /^(`{3,})/.exec(line);
    if (fence === null) {
      out.push(false);
      if (m) fence = m[1];
    } else if (m && line.trim() === fence) {
      out.push(false);
      fence = null;
    } else out.push(true);
  }
  return out;
}

/** 1 節・2 節のパッケージの節: `### 名前 x.y.z` (1.1 などの番号の見出しは、版の形でないので入らない) */
interface Section {
  name: string;
  version: string;
  /** 節の「package.json の license」 */
  license?: string;
}
function sectionsOf(notices: string[], fenced: boolean[]): Section[] {
  const sections: Section[] = [];
  for (let i = 0; i < notices.length; i++) {
    if (fenced[i]) continue;
    const m = /^### ((?:@[\w.-]+\/)?[\w.-]+) (\d+\.\d+\.\d+)$/.exec(notices[i]);
    if (!m) continue;
    const s: Section = { name: m[1], version: m[2] };
    for (let j = i + 1; j < notices.length && !(!fenced[j] && /^#{1,3} /.test(notices[j])); j++) {
      const l = /^- package\.json の license: `([^`]+)`$/.exec(notices[j]);
      if (l) {
        s.license = l[1];
        break;
      }
    }
    sections.push(s);
  }
  return sections;
}

/**
 * 実行時の依存 (名前 版 → license): from (package-lock.json の packages の鍵。本体は '') の
 * dependencies から、npm の探し方 (入れ子の node_modules から順に上へ) で、依存の依存までたどる。
 * dev でないものを全部数えるのでなく、依存の木だけを数える
 */
function runtimeOf(from: string): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const seen = new Set<string>();
  const resolve = (at: string, name: string): string | undefined => {
    for (let dir = at; ; ) {
      const key = `${dir ? dir + '/' : ''}node_modules/${name}`;
      if (lock.packages[key]) return key;
      if (!dir) return undefined;
      const k = dir.lastIndexOf('/node_modules/');
      dir = k >= 0 ? dir.slice(0, k) : dir.startsWith('node_modules/') ? '' : dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    }
  };
  const walk = (at: string) => {
    for (const name of Object.keys(lock.packages[at]?.dependencies ?? {})) {
      const key = resolve(at, name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const p = lock.packages[key];
      if (p.version) out.set(`${name} ${p.version}`, p.license);
      walk(key);
    }
  };
  walk(from);
  return out;
}

/** THIRD_PARTY_NOTICES.md と、from の依存の木を照らし合わせる */
function checkNotices(label: string, noticesFile: string, from: string) {
  // Windows の git (core.autocrlf) は CRLF で取り出すので、行の末の \r を残さない
  const notices = fs.readFileSync(path.join(root, noticesFile), 'utf8').split(/\r?\n/);
  const fenced = insideFence(notices);
  const sections = sectionsOf(notices, fenced);
  const runtime = runtimeOf(from);

  describe(label, () => {
    it('実行時の依存のすべてに、同じ版の節がある (節の側にも、無くなった依存が残っていない)', () => {
      const listed = sections.map((s) => `${s.name} ${s.version}`);
      expect([...runtime.keys()].filter((k) => !listed.includes(k)), `表示の無い依存 (${noticesFile} に節を足す)`).toEqual([]);
      expect(listed.filter((k) => !runtime.has(k)), 'package-lock.json に無い版の節 (版を直すか、節を除く)').toEqual([]);
    });

    it('節の「package.json の license」が package-lock.json の license と同じ', () => {
      for (const s of sections) {
        expect(s.license, `${s.name} ${s.version} の license`).toBe(runtime.get(`${s.name} ${s.version}`));
      }
    });

    it('転記したライセンスの本文が node_modules のファイルと同じ', () => {
      let count = 0;
      for (let i = 0; i < notices.length; i++) {
        if (fenced[i]) continue;
        const m = /^`(node_modules\/[^`]+)` の本文:$/.exec(notices[i]);
        if (!m) continue;
        let j = i + 1;
        while (j < notices.length && !/^`{3,}/.test(notices[j])) j++;
        let k = j + 1;
        while (k < notices.length && fenced[k]) k++;
        const quoted = notices.slice(j + 1, k).join('\n');
        const file = fs.readFileSync(path.join(root, m[1]), 'utf8').replace(/\r\n/g, '\n');
        expect(quoted.trim(), m[1]).toBe(file.trim());
        count++;
      }
      expect(count).toBeGreaterThan(0);
    });
  });
}

checkNotices('THIRD_PARTY_NOTICES.md と依存の照合', 'THIRD_PARTY_NOTICES.md', '');

describe('THIRD_PARTY_NOTICES.md の 1.6 節 (バンドラーの手助けのコード) と package-lock.json の照合', () => {
  const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8').split(/\r?\n/);
  const fenced = insideFence(notices);
  const at = notices.findIndex((l, i) => !fenced[i] && /^### 1\.6 /.test(l));
  let end = at + 1;
  while (end < notices.length && !(!fenced[end] && /^#{1,3} /.test(notices[end]))) end++;

  it('見出しの rolldown・vite の版と license が package-lock.json と同じ', () => {
    expect(at).toBeGreaterThan(0);
    const m = /\(([^()]+)\)$/.exec(notices[at]);
    const listed = (m?.[1] ?? '').split('・').map((x) => x.trim().split(' '));
    expect(listed.map(([n]) => n).sort()).toEqual(['rolldown', 'vite']);
    const license = notices.slice(at, end).map((l) => /^- package\.json の license: `([^`]+)`/.exec(l)?.[1]).find(Boolean);
    for (const [name, version] of listed) {
      const p = lock.packages[`node_modules/${name}`];
      expect(p, name).toBeTruthy();
      expect(`${name} ${version}`).toBe(`${name} ${p.version}`);
      expect(license, `${name} の license`).toBe(p.license);
    }
  });

  it('転記した本文が node_modules のファイル (の初めの部分) と同じ', () => {
    let count = 0;
    for (let i = at; i < end; i++) {
      if (fenced[i]) continue;
      const m = /^`(node_modules\/[^`]+)` の(本文|初めの、.*部分.*):$/.exec(notices[i]);
      if (!m) continue;
      let j = i + 1;
      while (j < end && !/^`{3,}/.test(notices[j])) j++;
      let k = j + 1;
      while (k < end && fenced[k]) k++;
      const quoted = notices.slice(j + 1, k).join('\n').trim();
      const file = fs.readFileSync(path.join(root, m[1]), 'utf8').replace(/\r\n/g, '\n').trim();
      if (m[2] === '本文') expect(quoted, m[1]).toBe(file);
      else expect(file.startsWith(quoted) && quoted.length > 500, m[1]).toBe(true);
      count++;
    }
    expect(count).toBe(2);
  });
});

describe('THIRD_PARTY_NOTICES.md の 14 節と tools/api-docs の照合', () => {
  const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8').split(/\r?\n/);
  const fenced = insideFence(notices);
  const toolLock = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'api-docs', 'package-lock.json'), 'utf8')) as typeof lock;
  const sections: Array<{ name: string; version: string; license?: string }> = [];
  for (let i = 0; i < notices.length; i++) {
    const m = !fenced[i] && /^### 14\.\d+ ((?:@[\w.-]+\/)?[\w.-]+) \((\d+\.\d+\.\d+)\)$/.exec(notices[i]);
    if (!m) continue;
    let license: string | undefined;
    for (let j = i + 1; j < notices.length && !(!fenced[j] && /^#{1,3} /.test(notices[j])); j++) {
      const l = /^- package\.json の license: `([^`]+)`$/.exec(notices[j]);
      if (l) license = l[1];
    }
    sections.push({ name: m[1], version: m[2], license });
  }

  it('TypeDoc と lunr の節があり、版と license が tools/api-docs/package-lock.json と同じ', () => {
    expect(sections.map((s) => s.name).sort()).toEqual(['lunr', 'typedoc']);
    for (const s of sections) {
      const p = toolLock.packages[`node_modules/${s.name}`];
      expect(p, s.name).toBeTruthy();
      expect(`${s.name} ${s.version}`).toBe(`${s.name} ${p.version}`);
      expect(s.license, `${s.name} の license`).toBe(p.license);
    }
  });

  it('転記したライセンスの本文が tools/api-docs/node_modules のファイルと同じ (入っているときだけ)', () => {
    for (let i = 0; i < notices.length; i++) {
      if (fenced[i]) continue;
      const m = /^`(tools\/api-docs\/node_modules\/[^`]+)` の本文:$/.exec(notices[i]);
      if (!m) continue;
      const file = path.join(root, m[1]);
      if (!fs.existsSync(file)) continue;
      let j = i + 1;
      while (j < notices.length && !/^`{3,}/.test(notices[j])) j++;
      let k = j + 1;
      while (k < notices.length && fenced[k]) k++;
      expect(notices.slice(j + 1, k).join('\n').trim(), m[1]).toBe(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim());
    }
  });
});
