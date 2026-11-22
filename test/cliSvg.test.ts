/**
 * Node のコマンドの SVG・PNG の出力の指定 (--format・--pages・--dpi) と、出力の名前の付け方のテスト。
 * コマンドを動かして SVG を書くことは、cli.test.ts で確かめる
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parseArgs, parsePageRanges, planJobs, selectPages, missingPageRanges, pageFile, sameStatTarget, UsageError } from '../src/cli';

describe('--format・--pages', () => {
  it('--format は pdf・svg。書かなければ -o の拡張子 (.svg) で決める', () => {
    expect(parseArgs(['a.html']).format).toBe('pdf');
    expect(parseArgs(['a.html', '--format', 'svg']).format).toBe('svg');
    expect(parseArgs(['a.html', '-o', 'out/A.SVG']).format).toBe('svg');
    // -o の拡張子 (.pdf・.svg・.png) と食い違う形式は誤り。ほかの拡張子・拡張子の無い名前は、--format のとおり
    expect(() => parseArgs(['a.html', '-o', 'a.svg', '--format', 'pdf'])).toThrow(/-o の拡張子 \.svg と --format pdf が食い違います/);
    expect(() => parseArgs(['a.html', '-o', 'a.pdf', '--format', 'svg'])).toThrow(UsageError);
    expect(parseArgs(['a.html', '-o', 'a.PDF', '--format', 'pdf']).format).toBe('pdf');
    expect(parseArgs(['a.html', '-o', 'out', '--format', 'png']).format).toBe('png');
    expect(parseArgs(['a.html', '-o', 'a.bin', '--format', 'svg']).format).toBe('svg');
    // 入力が複数なら -o は出力先のディレクトリ (名前の拡張子を見ない)
    expect(parseArgs(['a.html', 'b.html', '-o', 'out.svg', '--format', 'pdf']).format).toBe('pdf');
    expect(parseArgs(['a.html', '-o', 'a.PNG']).format).toBe('png');
    expect(() => parseArgs(['a.html', '--format', 'jpeg'])).toThrow(UsageError);
  });

  it('PDF だけの指定は、SVG の出力と一緒に使えない。--pages は SVG だけ', () => {
    expect(() => parseArgs(['a.html', '--format', 'svg', '--pdfx', 'x1a'])).toThrow(/--pdfx/);
    expect(() => parseArgs(['a.html', '--format', 'svg', '--tagged'])).toThrow(/--tagged/);
    expect(() => parseArgs(['a.html', '--pages', '1'])).toThrow(/--pages/);
    expect(parseArgs(['a.html', '--format', 'svg', '--pages', '2-3']).pages).toEqual([{ from: 2, to: 3 }]);
  });

  it('報告を標準エラーに回すかの比べ (sameStatTarget): i ノードの番号が 0 のものは同じと見なさない', () => {
    expect(sameStatTarget({ dev: 5n, ino: 7n }, { dev: 5n, ino: 7n })).toBe(true);
    expect(sameStatTarget({ dev: 5n, ino: 7n }, { dev: 5n, ino: 8n })).toBe(false);
    // Windows の端末・パイプの fstat は ino が 0 のことがある (前は両方 0 で、同じものとして標準エラーに回した)
    expect(sameStatTarget({ dev: 0n, ino: 0n }, { dev: 0n, ino: 0n })).toBe(false);
  });

  it('--image-max-dpi の数の書き方は --dpi と同じ (数字と小数点。前は 0x10・1e3 も通った)', () => {
    expect(parseArgs(['a.html', '--image-max-dpi', '300']).imageMaxDpi).toBe(300);
    expect(parseArgs(['a.html', '--image-max-dpi', '150.5']).imageMaxDpi).toBe(150.5);
    for (const bad of ['0x10', '1e3', 'Infinity', '0.5', '-300', '', ' ', '9'.repeat(400)]) expect(() => parseArgs(['a.html', '--image-max-dpi', bad]), bad).toThrow(/--image-max-dpi/);
  });

  it('--dpi は PNG だけ。0 より大きく 2400 まで', () => {
    expect(parseArgs(['a.html', '--format', 'png', '--dpi', '150']).dpi).toBe(150);
    expect(parseArgs(['a.html', '-o', 'a.png']).dpi).toBeUndefined();
    expect(() => parseArgs(['a.html', '--dpi', '150'])).toThrow(/--dpi/);
    expect(() => parseArgs(['a.html', '--format', 'svg', '--dpi', '150'])).toThrow(/--dpi/);
    for (const bad of ['0', '-5', 'abc', '3000']) expect(() => parseArgs(['a.html', '--format', 'png', '--dpi', bad])).toThrow(UsageError);
    // 書き方は数字と小数点だけ (1e-3 などは、その書き方を文で知らせる)
    expect(() => parseArgs(['a.html', '--format', 'png', '--dpi', '1e-3'])).toThrow(/数字と小数点で書きます/);
    expect(() => parseArgs(['a.html', '--format', 'png', '--pdfa', '2b'])).toThrow(/--pdfa/);
  });

  it('ページの範囲を読む (1 から数える。終わりの無い範囲は最後まで)', () => {
    expect(parsePageRanges('1-3,5, 7-')).toEqual([{ from: 1, to: 3 }, { from: 5, to: 5 }, { from: 7 }]);
    for (const bad of ['', '0', '3-1', 'a', '1-2-3', '-2']) expect(() => parsePageRanges(bad)).toThrow(UsageError);
    expect(selectPages(parsePageRanges('1-3,5,7-'), 8)).toEqual([0, 1, 2, 4, 6, 7]);
    // 重なりは 1 度だけ、文書に無いページは除く
    expect(selectPages(parsePageRanges('2,1-2,9'), 3)).toEqual([0, 1]);
    expect(selectPages(undefined, 3)).toEqual([0, 1, 2]);
    // 文書に無いページを指す範囲 (初めの番号か、閉じた範囲の終わりがページ数を超える。終わりの無い範囲の終わりは見ない)
    expect(missingPageRanges(parsePageRanges('1,9'), 2)).toEqual([{ from: 9, to: 9 }]);
    expect(missingPageRanges(parsePageRanges('1-5,2-,3-'), 2)).toEqual([{ from: 1, to: 5 }, { from: 3 }]);
    expect(missingPageRanges(parsePageRanges('1-2,2-'), 2)).toEqual([]);
    expect(missingPageRanges(undefined, 2)).toEqual([]);
  });

  it('ページごとの SVG の名前 (複数なら -番号。番号はページ数の桁にそろえる)', () => {
    expect(pageFile('a.svg', 0, 1, false)).toBe('a.svg');
    expect(pageFile('a.svg', 2, 12, true)).toBe('a-03.svg');
    expect(pageFile('out', 0, 3, true)).toBe('out-1.svg');
    expect(pageFile('b.PNG', 1, 3, true, '.png')).toBe('b-2.PNG');
    expect(pageFile('b', 1, 3, true, '.png')).toBe('b-2.png');
  });

  it('入力から決める出力の名前は、形式の拡張子にする', () => {
    const jobs = planJobs({ inputs: ['/d/a.html', '/e/a.fo'], output: '/out', watch: false, format: 'svg' }, () => true);
    // 大文字と小文字を区別しないファイルシステムでは、A.pdf と a.pdf も同じ名前と見なして、後のものの名前を変える (前は書くところで誤り)
    expect(planJobs({ inputs: ['/d/A.html', '/d/a.fo'], watch: false }, () => false, () => false, undefined, true).map((j) => j.output)).toEqual([path.resolve('/d/A.pdf'), path.resolve('/d/a.fo.pdf')]);
    expect(planJobs({ inputs: ['/d/A.html', '/d/a.fo'], watch: false }, () => false, () => false, undefined, false).map((j) => j.output)).toEqual([path.resolve('/d/A.pdf'), path.resolve('/d/a.pdf')]);
    // 同じ入力をまとめても、渡した入力が複数なら -o は出力先のディレクトリ (前は a.html a.html -o outdir で、outdir という名前のファイルに書いた)
    expect(planJobs({ inputs: ['/d/a.html', '/d/a.html'], output: '/x/outdir', watch: false }, () => false, () => false).map((j) => j.output)).toEqual([path.resolve('/x/outdir/a.pdf')]);
    expect(planJobs({ inputs: ['/d/a.html', '/d/a.html'], output: '/x/outdir/', watch: false }, () => false, () => false).map((j) => j.output)).toEqual([path.resolve('/x/outdir/a.pdf')]);
    expect(() => planJobs({ inputs: ['/d/a.html', '/d/a.html'], output: '/x/existing.pdf', watch: false }, () => false, () => true)).toThrow(UsageError);
    // 大文字と小文字をそろえる機械でも、入力のまとめは道と実体だけで決める (A.html と a.html は、別のファイルなら別の入力)
    expect(planJobs({ inputs: ['/d/A.html', '/d/a.html'], output: '/out', watch: false }, () => true, () => false, [], true).map((j) => j.input)).toEqual([path.resolve('/d/A.html'), path.resolve('/d/a.html')]);
    // 同じ入力は 1 度だけ (知らせを notes に)
    const notes: string[] = [];
    expect(planJobs({ inputs: ['/d/a.html', '/d/./a.html', '/d/b.html'], watch: false }, () => false, () => false, notes).map((j) => j.input)).toEqual([path.resolve('/d/a.html'), path.resolve('/d/b.html')]);
    expect(notes.length).toBe(1);
    // ぶつかった後のものは、入力の名前を拡張子ごと残す (a-2.svg にすると、a.html が複数ページのとき、その 2 ページ目の名前と重なる)
    expect(jobs.map((j) => j.output)).toEqual([path.resolve('/out/a.svg'), path.resolve('/out/a.fo.svg')]);
    expect(planJobs({ inputs: ['/d/a.html', '/d/a.fo'], watch: false, format: 'svg' }, () => false).map((j) => j.output)).toEqual([path.resolve('/d/a.svg'), path.resolve('/d/a.fo.svg')]);
    expect(planJobs({ inputs: ['/d/a.html'], watch: false }, () => false)[0].output).toBe(path.resolve('/d/a.pdf'));
    expect(planJobs({ inputs: ['/d/a.html'], watch: false, format: 'png' }, () => false)[0].output).toBe(path.resolve('/d/a.png'));
  });
});
