/**
 * Node のコマンドの診断の文字の出力 (--diagnostics text) で、多い診断をまとめる決まりのテスト。
 * 字形の無い字は 1 行に、ほかの名前は TEXT_LINES_PER_CODE 行までにして、残りを「ほかに n 件 (m 種)」の 1 行にする
 */
import { describe, expect, it } from 'vitest';
import { diagnosticTextLines, errorText, jsonLine, printable, TEXT_LINES_PER_CODE } from '../src/cli';
import { KumioriError, KumioriPdfError } from '../src/errors';
import { DiagnosticList, MAX_DIAGNOSTICS_PER_CODE, diag, type Diagnostic } from '../src/diagnostics';

/** 字形の無い字の診断 (api.ts の形) */
const glyph = (cp: number, n = 1): Diagnostic => {
  const ch = String.fromCodePoint(cp);
  const u = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  return { ...diag('font/missing-glyph', `読み込んだどのフォントにも字形の無い文字があります (字形の無い文字の形で出ます): ${ch} (${u})`, { char: ch, codePoint: u }), ...(n > 1 ? { count: n } : {}) };
};

describe('診断の文字の出力のまとめ', () => {
  it('少ない診断は、1 件 1 行のまま', () => {
    const ds = [diag('layout/line-overflow', 'a'), diag('css/unknown-property', 'b', { property: 'x' }), glyph(0x0a2d, 4)];
    expect(diagnosticTextLines(ds)).toEqual(['  エラー [layout/line-overflow] a', '  警告 [css/unknown-property] b', '  エラー [font/missing-glyph] 読み込んだどのフォントにも字形の無い文字があります (字形の無い文字の形で出ます): ਭ (U+0A2D) (4 件)']);
  });

  it('字形の無い字は、多い順に 20 字の 1 行にまとめ、上限で省いた字も「ほか n 種」に数える', () => {
    const l = new DiagnosticList();
    l.add(diag('layout/line-overflow', 'a'));
    // 多い順に並んだ字 (api.ts が多い順に足す)。上限を超えた 5 字は、省いた分の 1 件になる
    for (let i = 0; i < MAX_DIAGNOSTICS_PER_CODE + 5; i++) l.add(glyph(0x0a00 + i, i < 3 ? 10 - i : 1));
    l.add(diag('layout/line-overflow', 'b'));
    const lines = diagnosticTextLines(l.list);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('  エラー [layout/line-overflow] a');
    expect(lines[1]).toMatch(/^ {2}エラー \[font\/missing-glyph\] 読み込んだどのフォントにも字形の無い文字があります \(字形の無い文字の形で出ます\): ਀ \(U\+0A00 ×10\)、ਁ \(U\+0A01 ×9\)、ਂ \(U\+0A02 ×8\)、ਃ \(U\+0A03\)、/);
    expect(lines[1]).toContain(`(多い順に ${TEXT_LINES_PER_CODE} 字) ほか ${MAX_DIAGNOSTICS_PER_CODE + 5 - TEXT_LINES_PER_CODE} 種`);
    expect(lines[2]).toBe('  エラー [layout/line-overflow] b');
  });

  it('ほかの名前は 20 行まで書き、残りと上限で省いた分を「同じ種類の…がほかに n 件 (m 種)」の 1 行にする', () => {
    const l = new DiagnosticList();
    for (let i = 0; i < MAX_DIAGNOSTICS_PER_CODE + 3; i++) l.add({ ...diag('css/unsupported', `u${i}`, { item: `u${i}` }), ...(i === 30 ? { count: 4 } : {}) });
    l.add(diag('layout/line-overflow', 'a'));
    const lines = diagnosticTextLines(l.list);
    expect(lines).toHaveLength(TEXT_LINES_PER_CODE + 2);
    expect(lines[0]).toBe('  警告 [css/unsupported] u0');
    expect(lines[TEXT_LINES_PER_CODE - 1]).toBe(`  警告 [css/unsupported] u${TEXT_LINES_PER_CODE - 1}`);
    // 残りは、残した 180 種 (うち 1 つは 4 件) と、上限で省いた 3 種
    const kinds = MAX_DIAGNOSTICS_PER_CODE - TEXT_LINES_PER_CODE + 3;
    expect(lines[TEXT_LINES_PER_CODE]).toBe(`  警告 [css/unsupported] 同じ種類の警告がほかに ${kinds + 3} 件 (${kinds} 種) あります (--diagnostics json では 1 件ずつ書きます)`);
    expect(lines[TEXT_LINES_PER_CODE + 1]).toBe('  エラー [layout/line-overflow] a');
  });
});

describe('診断の 1 行の書き方 (他人の書いた文書の字)', () => {
  it('JSON の行は、U+0085・U+2028・U+2029・字の向きの制御も \\uXXXX にする (改行として扱う読み手でも 1 件 1 行)', () => {
    const d = diag('image/not-found', 'x', { src: 'nope\u001b[31m\u2028\u2029\u0085\u202e.png' });
    const line = jsonLine(d);
    expect(line).not.toMatch(/[\u0085\u2028\u2029\u202e]/);
    expect(line).toContain('\\u001b[31m\\u2028\\u2029\\u0085\\u202e.png');
    expect(line.split(/\r\n|[\n\r\u000b\u000c\u001c-\u001e\u0085\u2028\u2029]/).length).toBe(1);
    expect(JSON.parse(line)).toEqual(d);
  });
  it('PDF/X・PDF/A の決まりに合わない所の一覧は、1 件ずつ行に分けて出す (ほかの誤りの文の改行は逃がす。行の中の制御文字も逃がす)', () => {
    expect(errorText(new KumioriPdfError('pdfx/not-conforming', '合いません:\n  - 一\n  - 二\u001b'))).toBe('合いません:\n  - 一\n  - 二\\x1b');
    expect(errorText(new KumioriPdfError('pdfa/not-conforming', 'a\nb'))).toBe('a\nb');
    expect(errorText(new KumioriError('pdf/font-embed' as never, 'a\nb'))).toBe('a\\x0ab');
    expect(errorText(new Error('a\nb'))).toBe('a\\x0ab');
  });
  it('文字の出力は、C0・C1 の制御文字に加えて、行の区切り・段落の区切り・字の向きの制御も見える形にする', () => {
    expect(printable('a\u001bb\u2028c\u2029d\u202ee\u2066f')).toBe('a\\x1bb\\u2028c\\u2029d\\u202ee\\u2066f');
    expect(printable('日本語\tタブ')).toBe('日本語\tタブ');
  });
  it('DEL・C1 の制御文字 (8 ビットの CSI U+009B)・字の向きの印 (U+200E・U+200F・U+061C)・BOM も、JSON と文字の出力の両方で見える形にする', () => {
    const raw = 'a\u009b31m\u007f\u200e\u200f\u061c\ufeffz';
    const line = jsonLine({ s: raw });
    expect(line).toBe('{"s":"a\\u009b31m\\u007f\\u200e\\u200f\\u061c\\ufeffz"}');
    expect(JSON.parse(line).s).toBe(raw);
    expect(printable(raw)).toBe('a\\x9b31m\\x7f\\u200e\\u200f\\u061c\\ufeffz');
  });
});
