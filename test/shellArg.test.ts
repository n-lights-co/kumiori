import { describe, expect, it } from 'vitest';
import { quoteWindowsArg, shellArg } from '../scripts/shellArg.mjs';

/**
 * Microsoft の C ランタイムが、コマンド行を引数 (argv[1] 以降) に分ける決まり (Microsoft の文書「Parsing C command-line arguments」) を、
 * そのまま書いたもの: 空白・タブで区切る。" で囲んだ中の空白は区切らない。囲んだ中の "" は字の " 1 つ。
 * \ は " の直前に続くときだけ特別で、2n 個なら n 個の \ と区切りの "、2n+1 個なら n 個の \ と字の "。ほかの \ はそのまま
 */
function parseWindowsArgs(line: string): string[] {
  const args: string[] = [];
  let cur = '';
  let inArg = false;
  let quoted = false;
  for (let i = 0; i < line.length; ) {
    const c = line[i];
    if (!quoted && (c === ' ' || c === '\t')) {
      if (inArg) args.push(cur);
      cur = '';
      inArg = false;
      i++;
      continue;
    }
    inArg = true;
    if (c === '\\') {
      let n = 0;
      while (line[i] === '\\') {
        n++;
        i++;
      }
      if (line[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2));
        if (n % 2) {
          cur += '"';
          i++;
        }
        // 偶数個なら、" は次の回で区切りとして読む
      } else cur += '\\'.repeat(n);
      continue;
    }
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      quoted = !quoted;
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (inArg) args.push(cur);
  return args;
}

/** 直す前の scripts/ci-local.mjs の式 (" の前の \ を数えない) */
const oldShellArg = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

describe('parseWindowsArgs (テストの中の、決まりのとおりの解析)', () => {
  it('Microsoft の文書の表の例を、そのとおりに分ける', () => {
    expect(parseWindowsArgs('"a b c" d e')).toEqual(['a b c', 'd', 'e']);
    expect(parseWindowsArgs('"ab\\"c" "\\\\" d')).toEqual(['ab"c', '\\', 'd']);
    expect(parseWindowsArgs('a\\\\\\b d"e f"g h')).toEqual(['a\\\\\\b', 'de fg', 'h']);
    expect(parseWindowsArgs('a\\\\\\"b c d')).toEqual(['a\\"b', 'c', 'd']);
    expect(parseWindowsArgs('a\\\\\\\\"b c" d e')).toEqual(['a\\\\b c', 'd', 'e']);
    expect(parseWindowsArgs('a"b"" c d')).toEqual(['ab" c d']);
  });
});

/** scripts/ci-local.mjs が shell を通して npm を動かすとき (直に走らせたときの Windows) の引数の囲み方 (scripts/shellArg.mjs) */
describe('shellArg', () => {
  it('Windows でないときは、何も変えない', () => {
    for (const s of ['/tmp/a b', 'a"b', 'a\\"b', 'C:\\dir with space\\', ''])
      for (const p of ['linux', 'darwin']) expect(shellArg(s, p)).toBe(s);
  });
  it('空白も " も無い引数は、そのまま', () => {
    expect(shellArg('--emptyOutDir', 'win32')).toBe('--emptyOutDir');
    expect(shellArg('C:\\Users\\me\\AppData\\Local\\Temp\\kumiori-ci-pages-AbC123', 'win32')).toBe('C:\\Users\\me\\AppData\\Local\\Temp\\kumiori-ci-pages-AbC123');
    expect(shellArg('C:\\a\\', 'win32')).toBe('C:\\a\\');
  });
  it('空白を含むパスは " で囲む', () => {
    expect(shellArg('C:\\Users\\Taro Yamada\\AppData\\Local\\Temp\\kumiori-ci-pages-x', 'win32')).toBe('"C:\\Users\\Taro Yamada\\AppData\\Local\\Temp\\kumiori-ci-pages-x"');
    expect(shellArg('a\tb', 'win32')).toBe('"a\tb"');
  });
  it('" と、その前の \\、終わりの \\ を、決まりのとおりに書く。途中の \\ はそのまま', () => {
    expect(shellArg('a"b', 'win32')).toBe('"a\\"b"');
    expect(shellArg('a\\"b', 'win32')).toBe('"a\\\\\\"b"');
    expect(shellArg('C:\\dir with space\\', 'win32')).toBe('"C:\\dir with space\\\\"');
    expect(shellArg('C:\\a b\\c', 'win32')).toBe('"C:\\a b\\c"');
    expect(shellArg('', 'win32')).toBe('""');
  });
  it('囲んだものを決まりのとおりに解析し直すと、元の 1 つの引数に戻る', () => {
    const cases = [
      'a b',
      'a"b',
      'a\\"b',
      'a\\\\"b',
      'a\\\\\\"b',
      '"',
      '""',
      '\\"',
      '"\\',
      'a b\\',
      'a b\\\\',
      'a b\\\\\\',
      'C:\\dir with space\\',
      'C:\\a b\\c',
      'C:\\a b\\\\c',
      '\\\\server\\share\\a b',
      ' ',
      '\t',
      'x "y" \\z\\ "',
      '',
    ];
    for (const s of cases) {
      expect(parseWindowsArgs(quoteWindowsArg(s)), s).toEqual([s]);
      expect(parseWindowsArgs(shellArg(s, 'win32')), s).toEqual([s]);
      // ほかの引数と並べても、境が崩れない
      expect(parseWindowsArgs(`--outDir ${shellArg(s, 'win32')} --emptyOutDir`), s).toEqual(['--outDir', s, '--emptyOutDir']);
    }
    // \ と " を組み合わせた、長さ 4 までのすべての並び
    const chars = ['\\', '"', ' ', 'a'];
    let all = [''];
    for (let n = 0; n < 4; n++) all = all.flatMap((s) => chars.map((c) => s + c));
    for (const s of all) expect(parseWindowsArgs(shellArg(s, 'win32')), s).toEqual([s]);
  });
  it('直す前の式では戻らない例がある (" の前の \\・終わりの \\)', () => {
    for (const s of ['a\\"b', 'C:\\dir with space\\', 'a b\\\\']) expect(parseWindowsArgs(oldShellArg(s)), s).not.toEqual([s]);
    // 前の \ の無い " だけなら、直す前の式でも戻る
    expect(parseWindowsArgs(oldShellArg('a"b'))).toEqual(['a"b']);
  });
});
