/**
 * 知っている CSS のプロパティの、読めない値の宣言を警告に出す (css/invalid-value)。
 * CSS 2.1 §4.2: 読めない値の宣言は、宣言ごと無視する。黙って捨てずに、値の誤りか未対応かを知らせる。
 *  - 正しい CSS だが Kumiori が読まない値 (font のシステムの書体の名前など) は、未対応 (css/unsupported) に数える
 *  - 互換の指定 (--style ah) のときだけ読む拡張の値は、互換の指定の無いときに未対応 (「--style ah のときだけ解釈する値」) に数える
 *  - ブラウザ向けの予備の値 (接頭辞付きの値・同じ規則の、同じプロパティの読める宣言) は数えない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_AH } from '../src/cssCascade';
import { parseCss } from '../src/htmlPaged';
import { splitInvalidValueKey, unsupportedCssReport } from '../src/cssUnsupported';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import { ensureFonts, fontDir } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
}, 300_000);

const rep = (css: string, ah = false) => unsupportedCssReport(parseCss(css), undefined, ah ? ALL_AH : undefined);

describe('読めない値の宣言の数え方 (cssUnsupported)', () => {
  it('知っているプロパティの読めない値を「性質: 値」ごとに数える (一括指定も)', () => {
    const r = rep('p { display: foo; color: notacolor; margin: foo; text-wrap-style: bogus } a { display: foo }');
    expect(r.invalid).toEqual({ 'display: foo': 2, 'color: notacolor': 1, 'margin: foo': 1, 'text-wrap-style: bogus': 1 });
    expect(r.unknown).toEqual({});
  });
  it('読める値・var()・attr()・接頭辞付きの値・自前で読む値は数えない', () => {
    const r = rep(
      'p { display: flow-root; color: rgb(0 0 0 / 50%); margin: var(--m); width: attr(data-w px); display: -webkit-box; width: -moz-available;' +
        ' text-spacing-trim: trim-start; float: footnote; content: leader(dotted) target-counter(attr(href), page); list-style: inside disc; font: italic bold 12px/30px Georgia, serif }',
    );
    expect(r.invalid).toEqual({});
  });
  it('同じ規則に、同じプロパティの読める宣言があれば数えない (ブラウザ向けの予備の値)', () => {
    expect(rep('a { color: red; color: zzz(1) } b { color: zzz(1); color: red }').invalid).toEqual({});
    expect(rep('a { color: zzz(1) } b { color: red }').invalid).toEqual({ 'color: zzz(1)': 1 });
  });
  it('自前で読むプロパティの値は、自前の値の検査で見る (text-spacing-trim: zzz は読めない)', () => {
    expect(rep('p { text-spacing-trim: zzz; ruby-align: zzz }').invalid).toEqual({ 'text-spacing-trim: zzz': 1, 'ruby-align: zzz': 1 });
  });
  it('CSS として正しいが読まない値 (font: caption・font-size: math) は、未対応に数える', () => {
    const r = rep('p { font: caption } q { font: Status-Bar } m { font-size: math }');
    expect(r.unsupported).toEqual({ 'font: caption': 1, 'font: status-bar': 1, 'font-size: math': 1 });
    expect(r.invalid).toEqual({});
  });
  it('互換の指定のときだけ読む拡張の値は、互換の指定の無いときに未対応に数え、互換の指定のときは数えない', () => {
    expect(rep('p { border-top-style: dot-dash }').unsupported).toEqual({ 'border-top-style: dot-dash (--style ah のときだけ解釈する値)': 1 });
    const ah = rep('p { border-top-style: dot-dash }', true);
    expect(ah.unsupported).toEqual({});
    expect(ah.invalid).toEqual({});
  });
  it('style 属性の宣言も数え、!important は値に含めない', async () => {
    const { parseHTML } = await import('linkedom');
    const { document } = parseHTML('<html><body><p style="display: foo !important; color: red">a</p><p style="color: zzz; color: blue">b</p></body></html>');
    expect(unsupportedCssReport(undefined, document as unknown as Document).invalid).toEqual({ 'display: foo': 1 });
  });
  it('鍵を性質と値に分ける', () => {
    expect(splitInvalidValueKey('font-family: a: b')).toEqual({ property: 'font-family', value: 'a: b' });
  });
});

describe('typeset の診断 (css/invalid-value)', () => {
  const page = (css: string) => `<!DOCTYPE html><html><head><title>t</title><style>\n${css}\n</style></head><body><p>x</p></body></html>`;
  it('名前・重さ・args・場所を出し、warnings にもまとめて出す', async () => {
    const r = await typesetHtml(page('p { display: foo }\nh1 { color: notacolor }'), { name: 't.html', loadFont });
    const ds = r.diagnostics.filter((d) => d.code === 'css/invalid-value');
    // 並びは、ほかの数えた診断と同じ (多い順、同じ数なら名前の順)
    expect(ds.map((d) => [d.severity, d.args])).toEqual([
      ['warning', { property: 'color', value: 'notacolor' }],
      ['warning', { property: 'display', value: 'foo' }],
    ]);
    expect(ds[1].source).toMatchObject({ file: 't.html', line: 2 });
    expect(ds[0].source).toMatchObject({ file: 't.html', line: 3 });
    expect(r.warnings.some((w) => /読めない値の CSS の宣言を無視しました.*display: foo/.test(w) || /invalid values.*display: foo/.test(w))).toBe(true);
  });
  it('正しい CSS には出さない。ignore で出さない', async () => {
    const ok = await typesetHtml(page('p { display: block; color: #333; margin: 1em auto }'), { name: 't.html', loadFont });
    expect(ok.diagnostics.filter((d) => d.code === 'css/invalid-value')).toEqual([]);
    const ig = await typesetHtml(page('p { display: foo }'), { name: 't.html', loadFont, diagnostics: { ignore: ['css/invalid-value'] } });
    expect(ig.diagnostics.filter((d) => d.code === 'css/invalid-value')).toEqual([]);
  });
  it('font: caption は未対応 (css/unsupported) に出し、互換の指定の値は --style ah のときに出さない', async () => {
    const r = await typesetHtml(page('p { font: caption; border-top-style: dot-dash }'), { name: 't.html', loadFont });
    expect(r.diagnostics.filter((d) => d.code === 'css/unsupported').map((d) => d.args?.item)).toEqual(expect.arrayContaining(['font: caption', 'border-top-style: dot-dash (--style ah のときだけ解釈する値)']));
    const ah = await typesetHtml(page('p { border-top-style: dot-dash }'), { name: 't.html', loadFont, style: 'ah' });
    expect(ah.diagnostics.filter((d) => /^css\/(unsupported|invalid-value)$/.test(d.code))).toEqual([]);
  });
});
