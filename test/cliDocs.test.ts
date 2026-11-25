/**
 * コマンドの説明書 (docs/cli.md・docs/en/cli.md) が、使い方 (--help の文) のオプションをすべて載せていること。
 * オプションを足したのに説明書を直し忘れることを防ぐ。
 *  - 使い方の文 (日本語・英語) から、オプションの名前 (--name・-o) を取り出す
 *  - 説明書の表の行 (| で始まる行) の 1 つ目の欄に `--name` があるかを見る
 *  - 逆に、説明書の表の 1 つ目の欄のオプションが、使い方の文にあることも見る (やめたオプションを説明書に残さない)
 *  - parseArgs の本文 (src/cli.ts のソースの文字列) が読むオプションの名前が、使い方の文のオプションと同じ集まりであることも見る
 *    (parseArgs にオプションを足したのに、使い方の文に書き忘れることを防ぐ)。parseArgs のオプションは、使い方の文の
 *    オプションの行 (2 字下げで始まる行) の先頭の欄にあること (ほかのオプションの説明の中で触れただけでは足りない)
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { USAGE_EN, USAGE_JA, parseArgs } from '../src/cli';

const root = path.resolve(__dirname, '..');

/** 文の中のオプションの名前 (--name と、1 字の -o・-h・-v)。`a-b` の中の -b や、数の範囲 (1-3) は取らない */
function optionNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*[a-z0-9]|-[a-z])(?![\w-])/g)) names.add(m[1]);
  return names;
}

/**
 * 使い方の文のオプションの行 (2 字下げで始まる行) の、行の頭に書いたオプションの名前 (2 字下げの直後の「-x, --name」か「--name」)。
 * 引数と説明の間の空白が 1 つの行 (--pdfx x1a|… 入稿用の…) もあるので、空白の数で欄を分けずに、行の頭の名前だけを取る
 */
function optionRowNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^ {2}((?:-[a-z], )?--?[a-z][\w-]*)/.exec(line);
    if (!m) continue;
    for (const n of optionNames(m[1])) names.add(n);
  }
  return names;
}

/** 説明書の表の行の、1 つ目の欄に書いたオプションの名前 */
function documentedOptions(file: string): Set<string> {
  const names = new Set<string>();
  for (const line of fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1] ?? '';
    for (const m of first.matchAll(/`(--?[a-z][a-z0-9-]*)`/g)) names.add(m[1]);
  }
  return names;
}

/**
 * parseArgs の本文 (ソースの文字列) と、その中でオプションの名前を照らす所。
 * parseArgs は、引数を 1 つずつ `const a = argv[k]` に取り、`a === '--name'` で照らす
 * (別名も `a === '-o' || a === '--output'` のように並べ、`--no-…` の形も名前をそのまま書く)。
 * ほかの照らし方 (case・startsWith・正規表現など) を足したら、下の取り出しが漏れるので、試験で止める
 */
function parseArgsSource() {
  const src = fs.readFileSync(path.join(root, 'src/cli.ts'), 'utf8');
  const start = src.indexOf('export function parseArgs(');
  const end = src.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error('src/cli.ts に parseArgs の本文が見つかりません');
  return src.slice(start, end);
}

/** parseArgs が読むオプションの名前 (`a === '--name'` と、左右を入れ替えた `'--name' === a` の名前。標準入力の `-` は入力なので除く) */
function parsedOptions(body: string): Set<string> {
  const names = new Set<string>();
  for (const m of body.matchAll(/\ba === '(-[^']*)'|'(-[^']*)' === a\b/g)) {
    const n = m[1] ?? m[2];
    if (n !== '-') names.add(n);
  }
  return names;
}

describe('コマンドの説明書 (docs/cli.md・docs/en/cli.md)', () => {
  const ja = optionNames(USAGE_JA);
  const en = optionNames(USAGE_EN);

  it('使い方の文から、オプションを取り出せる (日本語と英語で同じ)', () => {
    expect([...ja].sort()).toEqual([...en].sort());
    for (const o of ['-o', '--output', '--format', '--pdfua', '--fail-on', '-h', '--help', '-v', '--version']) expect(ja).toContain(o);
    // 取り出したものは、どれもコマンドが読むオプション (知らないオプションは parseArgs が誤りにする)
    for (const o of ja) {
      if (['--help', '-h', '--version', '-v'].includes(o)) continue;
      let err: unknown;
      try {
        parseArgs(['in.html', o, 'x']);
      } catch (e) {
        err = e;
      }
      expect(String(err ?? ''), o).not.toMatch(/知らないオプション|unknown option/);
    }
  });

  describe('parseArgs が読むオプションと、使い方の文のオプション', () => {
    const body = parseArgsSource();
    const parsed = parsedOptions(body);
    it('parseArgs は、引数を a に取り、a === の名前だけで照らす (ほかの照らし方があれば、取り出しを直す)', () => {
      expect(body).toMatch(/const a = argv\[k\];/);
      // a を使う所は、a === '…' (オプションの名前・標準入力の -) と、知らないオプションを見分ける a.startsWith('-') だけ
      // (比べる演算子・メソッドの呼び出し・関数への引数としての a。文言の中の英語の a は、後ろが演算子でないので当たらない)
      const uses = [...body.matchAll(/(?<![\w.$])a(?:\s*(?:===|!==|==|!=)\s*\S+|\.\w+\([^)]*\))|[\w.]+\(a(?=\s*[,)])/g)].map((m) => m[0]);
      // 入力のファイルとして足す out.inputs.push(a) も、名前を照らさないので除く
      const other = uses.filter((u) => !/^a === '-[^']*'/.test(u) && u !== "a.startsWith('-')" && u !== 'out.inputs.push(a');
      expect(other, 'parseArgs の中の、a === でない a の使い方').toEqual([]);
      // 右に a を置く比べ (=== a は名前を取り出せる 'x' === a だけ)・表を a で引く書き方 (FLAGS[a]・a in FLAGS)・a を値として渡す書き方は、
      // 名前を取り出せないので落とす
      const rightUses = [...body.matchAll(/(\S+)\s*(?:===|!==|==|!=)\s*a\b(?!\.)/g)].map((m) => m[0]).filter((u) => !/^'-[^']*' === a$/.test(u));
      expect(rightUses, 'parseArgs の中の、右に a を置く比べ').toEqual([]);
      for (const re of [/\[\s*a\s*\]/, /(?<![\w.$])a\s+in\s/, /\bin\s+a\b/]) expect(body, String(re)).not.toMatch(re);
      // a を通さずに argv を照らす所は、--lang を先に読む所だけ (--lang も a === で読む)
      const argvUses = [...body.matchAll(/argv\.(\w+)\(([^)]*)\)/g)].map((m) => m[0]);
      expect(argvUses).toEqual(["argv.indexOf('--lang')"]);
      for (const re of [/\bcase\s+['"`]-/, /\bswitch\s*\(/, /\.test\(a\)/, /\.(includes|has)\(a\)/]) expect(body, String(re)).not.toMatch(re);
      // 取り出せていること (少なすぎれば、書き方が変わった)
      expect(parsed.size).toBeGreaterThan(40);
      for (const o of ['-o', '--output', '--no-tagged', '--plugin-option', '--lang', '-h', '-v']) expect(parsed).toContain(o);
    });
    it('取り出した名前は、どれも parseArgs が知っている (知らない名前は誤り)', () => {
      for (const o of parsed) {
        if (['--help', '-h', '--version', '-v'].includes(o)) continue;
        let err: unknown;
        try {
          parseArgs(['in.html', o, 'x']);
        } catch (e) {
          err = e;
        }
        expect(String(err ?? ''), o).not.toMatch(/知らないオプション|unknown option/);
      }
      expect(() => parseArgs(['in.html', '--no-such-option'])).toThrow(/知らないオプション|unknown option/);
    });
    it('parseArgs が読むオプションは、使い方の文 (日本語・英語) にすべてあり、使い方の文のオプションは、どれも parseArgs が読む', () => {
      // 使い方の文に書かない (隠す) オプションは、いまは無い。足すときは、ここに理由を付けて除く
      const hidden = new Set<string>();
      expect([...parsed].filter((o) => !hidden.has(o) && !ja.has(o)), '使い方 (日本語) に無いオプション').toEqual([]);
      expect([...parsed].filter((o) => !hidden.has(o) && !en.has(o)), '使い方 (英語) に無いオプション').toEqual([]);
      expect([...ja].filter((o) => !parsed.has(o)), 'parseArgs が読まないオプション').toEqual([]);
    });
    it('parseArgs が読むオプションは、使い方の文 (日本語・英語) のオプションの行の先頭の欄にある (説明の中で触れただけでは足りない)', () => {
      const rowsJa = optionRowNames(USAGE_JA);
      const rowsEn = optionRowNames(USAGE_EN);
      expect(rowsJa.size).toBeGreaterThan(30);
      expect([...parsed].filter((o) => !rowsJa.has(o)), '使い方 (日本語) のオプションの行に無いオプション').toEqual([]);
      expect([...parsed].filter((o) => !rowsEn.has(o)), '使い方 (英語) のオプションの行に無いオプション').toEqual([]);
    });
    it('値をとるオプションは、どれも空の値 (\'\') を黙って受けない (値の誤りにする)', () => {
      // 値をとるかは、parseArgs(['in.html', o, '']) の '' が入力に入るかで見分ける (入力に入れば、値をとらないオプション)。
      // 空の値を受けるオプションを足すときは、ここに理由を付けて除く
      const allowEmpty = new Set<string>();
      const taking: string[] = [];
      const silent: string[] = [];
      for (const o of parsed) {
        if (['--help', '-h', '--version', '-v', '--list-limits'].includes(o)) continue;
        let err: unknown;
        let inputs: string[] = [];
        try {
          inputs = parseArgs(['in.html', o, '']).inputs;
        } catch (e) {
          err = e;
        }
        if (!err && inputs.includes('')) continue;
        taking.push(o);
        if (!err && !allowEmpty.has(o)) silent.push(o);
      }
      expect(taking.length).toBeGreaterThan(30);
      for (const o of ['--font-dir', '--base', '--plugin', '--limit', '--max-pages', '--css']) expect(taking).toContain(o);
      expect(silent, '空の値を受けるオプション').toEqual([]);
    });
  });

  for (const [file, lang] of [['docs/cli.md', '日本語'], ['docs/en/cli.md', '英語']] as const) {
    it(`${lang}の説明書の終了の状態に、--watch でもプラグインを読めなければ終了コード 1 で終わることを書く`, () => {
      // コマンドは、--watch でもプラグインを読めなければ見張らずに 1 で終わる (test/cli.test.ts で確かめる)。説明書の「--watch のときは
      // 終了コードは変わらない」と食い違わないように、断りを書く
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      const exit = text.slice(text.search(/^## (終了ステータス|Exit status)$/m));
      const watch = exit.split(/\r?\n/).find((l) => l.startsWith('With `--watch`') || l.startsWith('`--watch` のときは')) ?? '';
      expect(watch, file).toMatch(/`--plugin`[^。.]*(終了コード 1|exit code is 1)/);
    });
    it(`${lang}の説明書の表に、使い方のオプションがすべてある`, () => {
      const documented = documentedOptions(file);
      const missing = [...ja].filter((o) => !documented.has(o));
      expect(missing, `${file} の表に無いオプション`).toEqual([]);
    });
    it(`${lang}の説明書の表のオプションは、どれも使い方にある`, () => {
      const extra = [...documentedOptions(file)].filter((o) => !ja.has(o));
      expect(extra, `${file} の表にあって、使い方に無いオプション`).toEqual([]);
    });
  }
});
