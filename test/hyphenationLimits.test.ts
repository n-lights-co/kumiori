/**
 * 分綴の制限 (台帳 NC-04・NF-12):
 *  - CSS Text 4 §6.3.2〜§6.3.5 の hyphenate-character・hyphenate-limit-chars・hyphenate-limit-lines・hyphenate-limit-last・hyphenate-limit-zone
 *  - XSL 1.1 §7.10.1・§7.10.5〜§7.10.7・§7.16.1・§7.16.2 の country・hyphenation-character・hyphenation-push/remain-character-count・
 *    hyphenation-ladder-count・hyphenation-keep
 * どちらも同じ受け皿 (TextStyle.hyphenLimits) に写す。指定の無い文書の行分けは変えない
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { hyphenPositions, loadHyphenator } from '../src/hyphenation';
import { parseCss } from '../src/htmlPaged';
import { unsupportedCssReport } from '../src/cssUnsupported';
import { FontManager } from '../src/fontManager';
import { Measurer } from '../src/measurer';
import { LayoutEngine } from '../src/layoutEngine';
import { DEFAULT_FONTS, typesetHtml, type FontSpec } from '../src/index';
import type { Area, AreaTree, HyphenLimits } from '../src/types';
import { defaultFontBuffer, doc, ensureFonts, fontDir, walk } from './helpers';

const fileOf = (spec: FontSpec) => path.join(fontDir, path.basename(spec.urls.find((u) => !/^https:/.test(u)) ?? spec.urls[0]));
const loadFont = async (spec: FontSpec) => {
  const f = fileOf(spec);
  if (!fs.existsSync(f)) return undefined;
  const b = fs.readFileSync(f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Area Tree の行ごとの字 */
const linesOf = (tree: AreaTree): string[] => {
  const out: string[] = [];
  for (const sheet of tree.sheets)
    walk(sheet.page.regionBody as Area, (a) => {
      if (a.type !== 'line') return;
      let s = '';
      walk(a, (g) => {
        if (g.type === 'glyph') s += (g as unknown as { text: string }).text;
      });
      out.push(s);
    });
  return out;
};
/** 行末が分綴の字 (既定は U+002D) の行の番号 */
const hyphenated = (ls: string[], ch = '-') => ls.flatMap((l, k) => (l.endsWith(ch) ? [k] : []));

const TEXT = 'Typesetting engines must balance typographic considerations such as justification, hyphenation, and internationalization requirements';

let engine: LayoutEngine;
beforeAll(async () => {
  await ensureFonts(DEFAULT_FONTS.base);
  for (const l of ['en', 'en-GB']) await loadHyphenator(l);
  const fonts = new FontManager();
  await fonts.registerBuffer('Arimo', 400, await defaultFontBuffer('Arimo-Regular.ttf'), false);
  engine = new LayoutEngine(fonts, new Measurer(fonts, 'fontkit'), { defaultFontFamily: 'Arimo', hyphenate: hyphenPositions });
}, 300_000);

/** 幅 width pt (字は 10pt の Arimo) の、分綴する英語の段落の行 */
const lay = (text: string | unknown[], width: number, hyphenLimits?: HyphenLimits, extra: object = {}) =>
  linesOf(engine.layout(doc([{ type: 'block', width, hyphenate: true, language: 'en', textAlign: 'start', ...(hyphenLimits ? { hyphenLimits } : {}), ...extra, children: typeof text === 'string' ? [text] : text } as never])));

describe('分綴の制限 (組版)', () => {
  it('指定が無いとき: 行末の字は U+002D、語は 5 字以上、切れ目の前後は 2 字以上 (これまでと同じ)。空の組 (初期値に戻す指定) も同じ', () => {
    const base = lay(TEXT, 80);
    expect(base).toEqual(['Typesetting en-', 'gines must bal-', 'ance typographic', 'considerations', 'such as justifica-', 'tion, hyphenation,', 'and international-', 'ization require-', 'ments']);
    expect(lay(TEXT, 80, {})).toEqual(base);
    // CSS Text 4 §6.3.4 の注が auto に勧める値 (語 5・前 2・後 2) を指定しても同じ
    expect(lay(TEXT, 80, { minWord: 5, minBefore: 2, minAfter: 2 })).toEqual(base);
    // 4 字の語は分綴しない
    expect(lay('also into', 14).join('|')).not.toContain('-');
  });

  it('hyphenate-character: 行末に出す字を替える。2 字以上の文字列・空の文字列 (何も出さずに分ける) も', () => {
    const base = lay(TEXT, 80);
    const u2010 = lay(TEXT, 80, { character: '\u2010' });
    expect(u2010).toEqual(base.map((l) => l.replace(/-$/, '\u2010')));
    expect(hyphenated(u2010, '\u2010')).toEqual([0, 1, 4, 6, 7]);
    const two = lay(TEXT, 100, { character: '=>' });
    expect(two.filter((l) => l.endsWith('=>')).length).toBeGreaterThan(0);
    expect(two.join('').replace(/=>| /g, '')).toBe(TEXT.replace(/ /g, ''));
    // 空の文字列: 語の途中で分かれるが、字は足されない
    const none = lay(TEXT, 80, { character: '' });
    expect(none.join('|')).not.toContain('-');
    expect(none[0]).toBe('Typesetting en');
    expect(none[1].startsWith('gines')).toBe(true);
  });

  it('hyphenate-limit-chars: 語の最小の字数・切れ目の前後の最小の字数', () => {
    // 語 12 字以上: typographic (11 字) は分けない。considerations (14 字) は分ける
    const w12 = lay(TEXT, 80, { minWord: 12 });
    expect(w12).toContain('typographic con-');
    expect(w12.join('|')).not.toMatch(/Typesetting en-|typo-/);
    // 前後 4 字以上: en-gines (前 2 字)・bal-ance (前 3 字)・re-quirements は使わない
    const b4 = lay(TEXT, 80, { minBefore: 4, minAfter: 4 });
    for (const l of b4.filter((x) => x.endsWith('-'))) expect(l.split(' ').pop()!.length - 1).toBeGreaterThanOrEqual(4);
    expect(b4.slice(0, 3)).toEqual(['Typesetting', 'engines must', 'balance typo-']);
    // 後ろ 9 字以上: justifica-tion (後ろ 4 字)・international-ization (後ろ 7 字) は使わない
    const a9 = lay(TEXT, 80, { minAfter: 9 });
    expect(a9.join('|')).not.toMatch(/justifica-|international-/);
    // 語 4 字以上に下げると、4 字の語も分ける (規則が許す位置で。前後は規則の決まりで 2 字以上)
    expect(lay('also into', 14, { minWord: 4 })).toEqual(['al-', 'so', 'in-', 'to']);
  });

  it('hyphenate-limit-lines・hyphenation-ladder-count: 続けて分綴する行の数の上限。超える行は、語を次の行へ送る', () => {
    // 制限なし: 1・2 行目、7・8 行目が続けて分綴される
    expect(hyphenated(lay(TEXT, 80))).toEqual([0, 1, 4, 6, 7]);
    const one = lay(TEXT, 80, { maxLines: 1 });
    expect(one).toEqual(['Typesetting en-', 'gines must', 'balance typo-', 'graphic', 'considerations', 'such as justifica-', 'tion, hyphenation,', 'and international-', 'ization', 'requirements']);
    const hs = hyphenated(one);
    for (let k = 1; k < hs.length; k++) expect(hs[k] - hs[k - 1]).toBeGreaterThan(1);
    // 2 行まで: 続けて 3 行は分綴しない
    const narrow = lay(TEXT, 60, { maxLines: 2 });
    const h2 = hyphenated(narrow);
    for (let k = 2; k < h2.length; k++) expect(h2[k] - h2[k - 2]).toBeGreaterThan(2);
    // 0: 分綴しない (どの語も 1 行に収まる幅)
    expect(hyphenated(lay(TEXT, 100))).toEqual([1, 4, 5]);
    expect(hyphenated(lay(TEXT, 100, { maxLines: 0 }))).toEqual([]);
    // 上限が大きければ、制限なしと同じ
    expect(lay(TEXT, 80, { maxLines: 5 })).toEqual(lay(TEXT, 80));
  });

  it('ほかに分けられる位置の無い行 (1 語だけの行) は、制限があっても分綴する (CSS Text 4 §6.3.5: 守れないことがある)', () => {
    const ls = lay('internationalization', 50, { maxLines: 0 });
    expect(ls.length).toBeGreaterThan(1);
    expect(ls[0].endsWith('-')).toBe(true);
  });

  it('hyphenate-limit-last: always は、段落の最後の行の 1 つ前の行を分綴しない (CSS Text 4 §6.3.5 の例)', () => {
    const base = lay(TEXT, 80);
    expect(base.slice(-2)).toEqual(['ization require-', 'ments']);
    const last = lay(TEXT, 80, { noLast: true });
    expect(last.slice(-2)).toEqual(['ization', 'requirements']);
    // ほかの行は変わらない
    expect(last.slice(0, 7)).toEqual(base.slice(0, 7));
    // 仕様の例: 「to show Antarc-/tica.」は「to show/Antarctica.」になる
    const ex = 'This is just a simple example to show Antarctica.';
    const w = 72;
    expect(lay(ex, w).slice(-2)).toEqual(['to show Antarc-', 'tica.']);
    expect(lay(ex, w, { noLast: true }).slice(-2)).toEqual(['to show', 'Antarctica.']);
  });

  it('hyphenate-limit-zone: 語を次の行へ送ったときの行末の空きが、この幅以下なら分綴しない。百分率は行の長さに対する割合', () => {
    const base = lay(TEXT, 80);
    // 1 行目「Typesetting」だけにすると空きは約 28pt、2 行目「gines must」→ …。空きが大きい行だけ分綴が残る
    // 1 行目を「Typesetting」だけにしたときの空きは約 28pt: 20pt の幅では分綴し、30pt の幅では分綴しない
    expect(lay(TEXT, 80, { zone: 20 })).toEqual(base);
    const z = lay(TEXT, 80, { zone: 30 });
    expect(z.slice(0, 4)).toEqual(['Typesetting', 'engines must', 'balance typo-', 'graphic consider-']);
    expect(lay(TEXT, 80, { zoneRatio: 0.375 })).toEqual(z);
    // 行の長さと同じ幅: どの行も分綴しない
    expect(hyphenated(lay(TEXT, 100, { zone: 100 }))).toEqual([]);
    // ごく小さい幅: 変わらない
    expect(lay(TEXT, 80, { zone: 0.5 })).toEqual(base);
  });

  it('ソフトハイフン (U+00AD) で分けた行にも、行末の字・行の数の上限・最後の行の扱いが効く。字数の制限は、指定したときだけ効く', () => {
    const soft = 'inter\u00ADnational\u00ADization';
    expect(lay(soft, 50, undefined, { hyphenate: false })[0]).toBe('inter-');
    expect(lay(soft, 50, { character: '\u2010' }, { hyphenate: false })[0]).toBe('inter\u2010');
    // 字数の制限の指定が無ければ、短い語のソフトハイフンも使う (これまでと同じ)
    expect(lay('xx ab\u00ADcd', 20, undefined, { hyphenate: false })).toEqual(['xx', 'ab-', 'cd']);
    // 指定すれば、足りない位置は使わない。結合文字 (Mn) は字数に数えない (§6.3.4): 「ré」(r・e・U+0301) は 2 字
    const word = 'xx re\u0301\u00ADsume\u0301s';
    expect(lay(word, 22, undefined, { hyphenate: false })[1].normalize('NFD')).toBe('re\u0301-');
    expect(lay(word, 22, { minBefore: 2 }, { hyphenate: false })[1].normalize('NFD')).toBe('re\u0301-');
    expect(lay(word, 22, { minBefore: 3 }, { hyphenate: false }).join('|')).not.toContain('-');
    expect(lay(word, 22, { minWord: 8 }, { hyphenate: false }).join('|')).not.toContain('-');
    expect(lay(word, 22, { minAfter: 6 }, { hyphenate: false }).join('|')).not.toContain('-');
    // 行の数の上限・最後の行
    const many = 'aa bbbb\u00ADcccc dd eeee\u00ADffff gg hhhh\u00ADiiii jj kkkk\u00ADllll mm';
    expect(lay(many, 44, undefined, { hyphenate: false })).toEqual(['aa bbbb-', 'cccc dd', 'eeeeffff', 'gg hhhh-', 'iiii jj kkkk-', 'llll mm']);
    expect(lay(many, 44, { noLast: true }, { hyphenate: false })).toEqual(['aa bbbb-', 'cccc dd', 'eeeeffff', 'gg hhhh-', 'iiii jj', 'kkkkllll', 'mm']);
    expect(hyphenated(lay(many, 44, { maxLines: 0 }, { hyphenate: false }))).toEqual([]);
  });

  it('縦書きでも同じに効く', () => {
    const v = (lim?: HyphenLimits) => linesOf(engine.layout(doc([{ type: 'block', height: 100, hyphenate: true, language: 'en', textAlign: 'start', ...(lim ? { hyphenLimits: lim } : {}), children: [TEXT] } as never], 'vertical-rl')));
    const base = v();
    expect(hyphenated(base).length).toBeGreaterThan(0);
    expect(hyphenated(v({ maxLines: 0 }))).toEqual([]);
    expect(v({ character: '\u2010' }).some((l) => l.endsWith('\u2010'))).toBe(true);
  });
});

describe('分綴の制限 (CSS)', () => {
  const html = (style: string, body = TEXT, width = '80pt') =>
    `<!DOCTYPE html><html lang="en"><head><title>t</title><style>@page { size: 300pt 400pt; margin: 20pt } body { margin: 0; font: 10pt Arimo, sans-serif } p { margin: 0; width: ${width}; hyphens: auto; ${style} }</style></head><body><p>${body}</p></body></html>`;
  const run = async (style: string, body?: string, width?: string) => {
    const r = await typesetHtml(html(style, body, width), { name: 't.html', loadFont });
    return { lines: linesOf(r.areaTree), warnings: r.warnings, tree: r.areaTree };
  };

  it('指定の無い文書の行分けは、初期値を書いたときと同じ', async () => {
    const base = await run('');
    expect(hyphenated(base.lines).length).toBeGreaterThan(1);
    const init = await run('hyphenate-character: auto; hyphenate-limit-chars: auto; hyphenate-limit-lines: no-limit; hyphenate-limit-last: none; hyphenate-limit-zone: 0');
    expect(init.lines).toEqual(base.lines);
    expect(init.warnings.join('\n')).not.toMatch(/hyphenate/);
  });

  it('hyphenate-character・hyphenate-limit-chars・hyphenate-limit-lines・hyphenate-limit-last: always・hyphenate-limit-zone が効き、警告は出ない', async () => {
    const base = await run('');
    const ch = await run('hyphenate-character: "\\2010"');
    expect(ch.lines).toEqual(base.lines.map((l) => l.replace(/-$/, '\u2010')));
    expect(ch.warnings.join('\n')).not.toMatch(/hyphenate/);
    expect((await run('hyphenate-character: ""')).lines.join('|')).not.toContain('-');
    // 語 12 字以上・前後 4 字以上
    const cs = await run('hyphenate-limit-chars: 12 4');
    for (const l of cs.lines.filter((x) => x.endsWith('-'))) {
      const w = l.split(' ').pop()!;
      expect(w.length - 1).toBeGreaterThanOrEqual(4);
    }
    expect(cs.lines.join('|')).not.toMatch(/typo-|Typesetting en-/);
    // auto 3 (仕様の例): 語は UA の決めた 5 字、前後は 3 字
    const a3 = await run('hyphenate-limit-chars: auto 3');
    expect(a3.lines.join('|')).not.toMatch(/\ben-|\bre-/);
    const one = hyphenated((await run('hyphenate-limit-lines: 1')).lines);
    expect(one.length).toBeGreaterThan(0);
    for (let k = 1; k < one.length; k++) expect(one[k] - one[k - 1]).toBeGreaterThan(1);
    expect(hyphenated((await run('hyphenate-limit-lines: 0', TEXT, '100pt')).lines)).toEqual([]);
    // 仕様の例 (§6.3.5): 「to show Antarc-/tica.」が「to show/Antarctica.」になる
    const ex = 'This is just a simple example to show Antarctica.';
    expect((await run('', ex, '72pt')).lines.slice(-2)[0]).toMatch(/^to show Antarc(ti)?-$/);
    expect((await run('hyphenate-limit-last: always', ex, '72pt')).lines.slice(-2)).toEqual(['to show', 'Antarctica.']);
    expect(hyphenated((await run('hyphenate-limit-zone: 100%', TEXT, '100pt')).lines)).toEqual([]);
    expect(hyphenated((await run('hyphenate-limit-zone: 10em', TEXT, '100pt')).lines)).toEqual([]);
    const z = await run('hyphenate-limit-zone: 37.5%');
    expect(z.lines[0]).toBe('Typesetting');
    expect((await run('hyphenate-limit-zone: 3em')).lines).toEqual(z.lines);
    expect(z.warnings.join('\n')).not.toMatch(/hyphenate/);
  });

  it('受け継ぐ。子の指定で初期値に戻せる。読めない値の宣言は捨てる', async () => {
    const r = await typesetHtml(
      `<!DOCTYPE html><html lang="en"><head><title>t</title><style>body { margin: 0; font: 10pt Arimo, sans-serif; hyphens: auto; hyphenate-character: "="; hyphenate-limit-lines: 0 } p { margin: 0; width: 80pt } .b { hyphenate-limit-lines: no-limit } .c { hyphenate-limit-lines: no-limit; hyphenate-character: auto } .d { hyphenate-limit-lines: no-limit; hyphenate-limit-chars: 1 2 3 4; hyphenate-limit-lines: -1; hyphenate-character: x }</style></head><body><p class="a">${TEXT}</p><p class="b">${TEXT}</p><p class="c">${TEXT}</p><p class="d">${TEXT}</p></body></html>`,
      { name: 't.html', loadFont },
    );
    const ls = linesOf(r.areaTree);
    const cut = ls.flatMap((l, k) => (l.startsWith('Typesetting') ? [k] : []));
    expect(cut.length).toBe(4);
    const [a, b, c, d] = cut.map((s, k) => ls.slice(s, cut[k + 1]));
    expect(a.some((l) => /[=-]$/.test(l))).toBe(false);
    expect(hyphenated(b, '=').length).toBeGreaterThan(1);
    expect(hyphenated(c, '-').length).toBeGreaterThan(1);
    expect(d).toEqual(b);
  });

  it('ソフトハイフンで分けた行にも hyphenate-character の字が出る (hyphens: manual。§6.3.2 の注)', async () => {
    const r = await run('hyphens: manual; hyphenate-character: "\\2010"', 'inter&shy;national&shy;ization', '50pt');
    expect(r.lines[0]).toBe('inter\u2010');
  });

  it('hyphenate-limit-last の column・page・spread は読まない: 未対応の値として警告に出す (none と同じに組む)', async () => {
    const rep = unsupportedCssReport(parseCss('p { hyphenate-limit-last: page } div { hyphenate-limit-last: column; hyphenate-limit-last: spread } a { hyphenate-limit-last: always; hyphenate-limit-lines: 2; hyphenate-character: "-"; hyphenate-limit-chars: 6 3; hyphenate-limit-zone: 10% }'));
    expect(rep.unsupported).toEqual({ 'hyphenate-limit-last: page': 1, 'hyphenate-limit-last: spread': 1 });
    expect(rep.unknown).toEqual({});
    const base = await run('');
    const page = await run('hyphenate-limit-last: page');
    expect(page.lines).toEqual(base.lines);
    expect(page.warnings.join('\n')).toMatch(/hyphenate-limit-last: page/);
  });

  it('行末の字は、ほかの字と同じ字形の箱 (glyph) として Area Tree に入る (PDF と Canvas は同じ箱を描く)', async () => {
    const r = await run('hyphenate-character: "\\2010"');
    const glyphs: Array<{ text: string; width: number }> = [];
    walk(r.tree.sheets[0].page.regionBody as Area, (g) => {
      if (g.type === 'glyph') glyphs.push(g as unknown as { text: string; width: number });
    });
    const hy = glyphs.filter((g) => g.text === '\u2010');
    expect(hy.length).toBeGreaterThan(1);
    for (const g of hy) expect(g.width).toBeGreaterThan(0);
  });
});
