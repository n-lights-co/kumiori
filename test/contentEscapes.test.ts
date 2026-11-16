import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { serializeCssString, unquote } from '../src/htmlPaged';

/**
 * content の文字列のエスケープ (CSS Syntax 3 §4.3.7) と、生成した内容の改行 (\A) の white-space による扱い
 * (CSS 2.1 §12.2・CSS Text 3 §4.1)。計算値を作る側 (cssCascade) と読む側 (parseContent・unquote) で書き方を揃える
 */

const load = (body: string, css: string) => {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  return importHtml(d, cascadeStyles(d, css, { viewport: { width: 600, height: 800 } }), { css });
};
/** 中身の字 (children をたどってつなぐ) */
const texts = (n: unknown): string => {
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) return n.map(texts).join('');
  if (n && typeof n === 'object') return (['children', 'body', 'rows', 'cells'] as const).map((k) => texts((n as Record<string, unknown>)[k] ?? [])).join('');
  return '';
};
const bodyText = (body: string, css: string) => texts(load(body, css).document.sequences.map((s) => s.flow));
const P = '<p>a<span class="q">b</span>c</p>';

describe('content の文字列のエスケープ', () => {
  it('計算値は CSS の文字列の書き方 (CSSOM §2.1 serialize a string) で、読み直すと元の字に戻る', () => {
    for (const s of ['X\nY', 'tab\tx', 'a\r\nb', 'q"q', 'b\\s', '—', 'AB', '\u0001\u007f', "it's"]) expect(unquote(serializeCssString(s))).toBe(s);
    expect(serializeCssString('X\nY')).toBe('"X\\a Y"');
    expect(serializeCssString('a"\\b')).toBe('"a\\"\\\\b"');
    expect(serializeCssString('\0')).toBe('"�"');
  });
  it('\\A は改行 (white-space: pre)。字「n」にならない', () => {
    expect(bodyText(P, '.q::before { content: "X\\A Y"; white-space: pre }')).toBe('aX\nYbc');
  });
  it('\\9 はタブ (pre では残し、normal では空白)', () => {
    expect(bodyText(P, '.q::before { content: "tab\\9 x"; white-space: pre }')).toBe('atab\txbc');
    expect(bodyText(P, '.q::before { content: "tab\\9 x" }')).toBe('atab xbc');
  });
  it('\\D\\A: CR は空白と同じ (CSS Text 3 §4.1)。pre では空白と改行、normal では空白 1 つ', () => {
    expect(bodyText(P, '.q::before { content: "X\\D\\A Y"; white-space: pre }')).toBe('aX \nYbc');
    expect(bodyText(P, '.q::before { content: "X\\D\\A Y" }')).toBe('aX Ybc');
  });
  it('\\"・\\\\・\\2014・\\000041 B (6 桁と後ろの空白 1 つ) は、これまでどおり', () => {
    expect(bodyText(P, '.q::before { content: "\\"\\\\\\2014\\000041 B" }')).toBe('a"\\—ABbc');
  });
  it('「\\」と改行は読み捨てる (CSS Syntax 3 §4.3.5。CRLF も)。16 進の後ろで読み捨てる空白は CSS の空白だけ (U+3000・U+00A0 は残す)', () => {
    expect(unquote('"ab\\\ncd"')).toBe('abcd');
    expect(unquote('"ab\\\r\ncd"')).toBe('abcd');
    expect(unquote('"\\41\r\nB"')).toBe('AB');
    expect(unquote('"\\25A0\u3000x"')).toBe('\u25a0\u3000x');
    expect(unquote('"\\25A0\u00a0x"')).toBe('\u25a0\u00a0x');
    expect(bodyText(P, '.q::before { content: "X\\\nY" }')).toBe('aXYbc');
    expect(bodyText(P, '.q::before { content: "X\\\r\nY" } .q { color: red }')).toBe('aXYbc');
    expect(bodyText(P, '.q::before { content: "\\25A0\u3000" }')).toBe('a\u25a0\u3000bc');
    // 余白の箱
    expect(texts(load('<p>x</p>', '@page { @top-center { content: "a\\\nb" } }').document.sequences[0].staticContent)).toBe('ab');
  });
  it('white-space の値ごと: normal・nowrap は空白、pre・pre-wrap・pre-line・break-spaces は改行', () => {
    for (const ws of ['normal', 'nowrap']) expect(bodyText(P, `.q::before { content: "X\\A Y"; white-space: ${ws} }`), ws).toBe('aX Ybc');
    for (const ws of ['pre', 'pre-wrap', 'pre-line', 'break-spaces']) expect(bodyText(P, `.q::before { content: "X\\A Y"; white-space: ${ws} }`), ws).toBe('aX\nYbc');
  });
  it('normal の改行は、文書の中の改行と同じ決まりで、前後が和文なら消す (文字列の端の改行は、前後の要素の字で決める)', () => {
    expect(bodyText(P.replace('b', 'い'), '.q::before { content: "あ\\Aう" }')).toBe('aあういc');
    expect(bodyText('<p>あ<span class="q">い</span>う</p>', '.q::before { content: "か\\A" }')).toBe('あかいう');
    expect(bodyText('<p>a<span class="q">b</span>c</p>', '.q::before { content: "x\\A" }')).toBe('ax bc');
  });
  it('::after と、続いた文字列', () => {
    expect(bodyText(P, '.q::after { content: "X" "\\A" "Y"; white-space: pre }')).toBe('abX\nYc');
    expect(bodyText(P, '.q::after { content: "X" "\\A" "Y" }')).toBe('abX Yc');
  });
  it('余白の箱の content: pre は改行、normal は空白', () => {
    const margin = (css: string) => texts(load('<p>x</p>', css).document.sequences[0].staticContent);
    expect(margin('@page { @top-center { content: "a\\A b"; white-space: pre } }')).toBe('a\nb');
    expect(margin('@page { @top-center { content: "a\\A b" } }')).toBe('a b');
    expect(margin('@page { white-space: pre-line; @top-center { content: "a\\A b" } }')).toBe('a\nb');
    expect(margin('@page { @top-center { content: "あ" "\\A" "い" } }')).toBe('あい');
  });
});
