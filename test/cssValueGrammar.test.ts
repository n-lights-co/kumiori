/**
 * 値の検査が緩かったプロパティを、仕様の値の定義に合わせて厳しくする (PKG-19 の (1))。
 * 読めない値の宣言は、構文の誤りとして捨て (前の宣言・継いだ値を使う。CSS 2.1 §4.2・Cascade 5 §5)、@supports にも対応していないと答える
 * (Conditional 3 §6.1)。値の文法は、それぞれの仕様の値の定義 (節は src/cssCascade.ts の validByGrammar・src/htmlPaged.ts の validPagedValue)
 */
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { cascadeStyles, expand, HTML_UA_CSS, supportsCssDeclaration, ALL_AH } from '../src/cssCascade';
import { importHtml } from '../src/htmlImport';
import { matchSupports, validPagedValue } from '../src/htmlPaged';

/** 性質 → [読める値, 読めない値] */
const CASES: Record<string, [string[], string[]]> = {
  'caption-side': [['top', 'bottom', 'inline-start', 'inline-end'], ['zzz', 'top bottom', '12qq', '-5']],
  'flex-direction': [['row', 'row-reverse', 'column', 'column-reverse'], ['zzz', 'row column', '1']],
  'flex-wrap': [['nowrap', 'wrap', 'wrap-reverse'], ['zzz', 'wrap nowrap', '"str"']],
  'flex-flow': [['row wrap', 'wrap-reverse', 'column'], ['zzz', 'row zzz']],
  'flex-grow': [['0', '1.5', 'calc(1 + 1)'], ['-5', 'zzz', '1 2', '1px']],
  'flex-shrink': [['0', '3'], ['-1', 'zzz']],
  flex: [['none', 'auto', '1', '1 1 0', '2 2 10%', '1 30px', '0 0 auto'], ['1 2 3 4 5 6 7', '1 1 30px 40px', '1 2 3']],
  'font-kerning': [['auto', 'normal', 'none'], ['zzz', '12qq', 'auto none']],
  'font-variant-caps': [['normal', 'small-caps', 'all-small-caps', 'petite-caps', 'all-petite-caps', 'unicase', 'titling-caps'], ['zzz', 'small-caps unicase']],
  'font-variant-position': [['normal', 'sub', 'super'], ['zzz', 'sub super']],
  'font-variant-ligatures': [['normal', 'none', 'common-ligatures', 'no-common-ligatures discretionary-ligatures', 'contextual historical-ligatures'], ['zzz', 'common-ligatures no-common-ligatures', 'normal none', '-5']],
  'font-variant-numeric': [['normal', 'oldstyle-nums', 'lining-nums tabular-nums', 'slashed-zero ordinal diagonal-fractions'], ['zzz', 'lining-nums oldstyle-nums', '12qq']],
  'font-style': [['normal', 'italic', 'oblique', 'oblique 10deg', 'oblique -5deg'], ['zzz', 'italic oblique', 'oblique 10', '12qq']],
  'font-stretch': [['normal', 'condensed', 'ultra-expanded', 'semi-condensed', '75%', '112.5%'], ['zzz', '-5', '-10%', '75', 'condensed expanded']],
  'font-width': [['normal', 'extra-condensed', '90%'], ['zzz', '12qq']],
  'font-family': [['serif', 'Noto Serif JP', '"Noto Sans JP", sans-serif', "'A B', C D", '游明朝, serif'], ['12qq', '-5', '1 2 3 4 5 6 7', 'serif,', 'A, 2B']],
  'line-break': [['auto', 'loose', 'normal', 'strict', 'anywhere'], ['zzz', 'loose strict']],
  'overflow-wrap': [['normal', 'break-word', 'anywhere'], ['zzz', '"str"']],
  'word-wrap': [['normal', 'break-word', 'anywhere'], ['zzz']],
  'word-break': [['normal', 'keep-all', 'break-all', 'break-word'], ['zzz', 'keep-all break-all']],
  'overflow-x': [['visible', 'hidden', 'clip', 'scroll', 'auto'], ['zzz', 'hidden auto', '-5']],
  'overflow-y': [['visible', 'hidden', 'clip', 'scroll', 'auto'], ['zzz']],
  overflow: [['hidden', 'auto', 'hidden visible', 'clip'], ['zzz', 'hidden zzz', '12qq']],
  'object-fit': [['fill', 'contain', 'cover', 'none', 'scale-down', 'contain scale-down'], ['zzz', 'contain cover', 'fill none']],
  'text-orientation': [['mixed', 'upright', 'sideways'], ['zzz', 'mixed upright']],
  'unicode-bidi': [['normal', 'embed', 'isolate', 'bidi-override', 'isolate-override', 'plaintext'], ['zzz', 'embed isolate']],
  'text-decoration-line': [['none', 'underline', 'underline overline', 'line-through underline overline'], ['zzz', 'underline underline', 'none underline', '12qq']],
  'text-decoration': [['none', 'underline', 'underline dotted red', 'overline 2px', 'underline wavy from-font blue'], ['zzz', 'underline zzz', '12qq', 'underline dotted dashed', 'red blue']],
  'text-emphasis-style': [['none', 'dot', 'filled sesame', 'open', 'circle open', '"*"'], ['zzz', 'dot circle', 'filled open', '-5']],
  'text-combine-upright': [['none', 'all', 'digits', 'digits 3'], ['zzz', 'digits 9', 'all digits', '-5']],
  'vertical-align': [['baseline', 'sub', 'super', 'top', 'text-top', 'middle', 'bottom', 'text-bottom', '2px', '-0.3em', '50%'], ['zzz', '12qq', 'top bottom', '1 2 3 4 5 6 7', '"str"']],
  'border-top-left-radius': [['4px', '10% 20%', '0'], ['zzz', '-5px', '1px 2px 3px', '12qq']],
  'border-radius': [['4px', '4px 8px', '1px 2px 3px 4px', '10px / 20px'], ['zzz', '-5px', '12qq']],
  'border-spacing': [['2px', '1px 3px', '0'], ['zzz', '-5px', '10%', '1px 2px 3px']],
  'aspect-ratio': [['auto', '16 / 9', '1.5', 'auto 4/3', '2 / 1 auto'], ['zzz', '-5', '1 2 3 4 5 6 7', '16 / 9 / 2', 'auto auto']],
  'align-content': [['normal', 'center', 'flex-start', 'space-between', 'stretch', 'safe center', 'baseline', 'first baseline'], ['zzz', 'left', 'safe stretch', 'center start', '12qq']],
  'justify-content': [['normal', 'center', 'flex-end', 'space-evenly', 'left', 'right', 'unsafe end'], ['zzz', 'baseline', 'safe space-between', '-5']],
  'align-items': [['normal', 'stretch', 'center', 'flex-start', 'self-end', 'baseline', 'last baseline', 'safe center'], ['zzz', 'left', 'space-between', 'auto']],
  'align-self': [['auto', 'normal', 'stretch', 'center', 'self-start', 'baseline', 'unsafe flex-end'], ['zzz', 'left', 'space-around', 'safe auto']],
  'counter-reset': [['none', 'c', 'c 3', 'a 1 b c -2', 'list-item'], ['12qq', '-5', '3 c', 'c 1 2', '"str"']],
  'counter-increment': [['none', 'c', 'c 2 d'], ['12qq', '1 2 3 4 5 6 7']],
  'counter-set': [['none', 'c 0'], ['12qq', 'c c 1 2']],
  'list-style-type': [['none', 'disc', 'decimal', 'my-style', '"-"', 'symbols(cyclic "*")'], ['12qq', '-5', 'disc decimal', '1 2 3 4 5 6 7']],
  'list-style': [['none', 'square inside', 'inside url(a.png) disc', 'none none', 'lower-roman'], ['12qq', 'disc circle', 'inside outside', '-5']],
  quotes: [['auto', 'none', '"«" "»"', '"«" "»" "‹" "›"'], ['zzz', '"a"', '"a" "b" "c"', '12qq']],
  columns: [['auto', '2', '10em', '2 10em', '10em auto', 'auto auto'], ['1 2 3 4 5 6 7', '2 3', '10em 20em']],
  page: [['auto', 'chapter', 'TOC', '--x'], ['12qq', '-5', '"str"', 'a b']],
  'ruby-position': [['over', 'under', 'alternate', 'alternate under', 'over alternate', 'inter-character'], ['zzz', 'over under', '12qq']],
  'border-block-style': [['solid', 'dashed dotted', 'none'], ['zzz', '12qq', 'solid zzz']],
  'border-inline-style': [['double', 'solid none'], ['zzz', '-5']],
  'border-inline-start-style': [['solid'], ['zzz', 'solid dashed']],
};

describe('PKG-19 値の文法を調べる性質 (カスケードの宣言の検査と @supports)', () => {
  for (const [prop, [good, bad]] of Object.entries(CASES)) {
    it(`${prop}: 読める値は真、読めない値は偽`, () => {
      for (const v of good) expect(supportsCssDeclaration(prop, v), `${prop}: ${v}`).toBe(true);
      for (const v of bad) expect(supportsCssDeclaration(prop, v), `${prop}: ${v}`).toBe(false);
      // @supports の答えも同じ。大域のキーワードは読める
      for (const v of good) expect(matchSupports(`(${prop}: ${v})`), `@supports ${prop}: ${v}`).toBe(true);
      for (const v of bad) expect(matchSupports(`(${prop}: ${v})`), `@supports ${prop}: ${v}`).toBe(false);
      expect(supportsCssDeclaration(prop, 'inherit')).toBe(true);
    });
  }
  it('負の値・小数を取る性質はそのまま (opacity・order・z-index。lax の一覧の見かけの緩さ)', () => {
    for (const [p, v] of [['opacity', '-5'], ['order', '-5'], ['z-index', '-5'], ['hyphenate-character', '"str"'], ['counter-reset', 'zzz-nonsense'], ['text-emphasis-style', '"str"']])
      expect(supportsCssDeclaration(p, v), `${p}: ${v}`).toBe(true);
  });
});

describe('PKG-19 読めない値の宣言は捨てて、前の宣言・継いだ値を使う (Cascade 5 §5)', () => {
  const computed = (css: string, prop: string, body = '<p id="a">a</p>') => {
    const doc = new DOMParser().parseFromString(`<html><head></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
    const el = doc.getElementsByTagName('p')[0] as unknown as Element;
    return cascadeStyles(doc, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }).style(el).getPropertyValue(prop);
  };
  it('同じ規則の後の読めない宣言は、前の宣言を消さない', () => {
    expect(computed('p { flex-wrap: wrap; flex-wrap: zzz }', 'flex-wrap')).toBe('wrap');
    expect(computed('p { overflow: hidden; overflow: zzz }', 'overflow-x')).toBe('hidden');
    expect(computed('p { vertical-align: top; vertical-align: zzz }', 'vertical-align')).toBe('top');
    expect(computed('p { text-decoration: underline; text-decoration: underline zzz }', 'text-decoration-line')).toBe('underline');
    expect(computed('p { flex: 2 1 10px; flex: 1 2 3 4 5 6 7 }', 'flex-grow')).toBe('2');
    expect(computed('p { columns: 3; columns: 1 2 3 4 5 6 7 }', 'column-count')).toBe('3');
    expect(computed('p { list-style: square; list-style: disc circle }', 'list-style-type')).toBe('square');
    expect(computed('p { font-family: serif; font-family: 12qq }', 'font-family')).toBe('serif');
    expect(computed('p { border-inline-start-style: solid; border-inline-start-style: zzz }', 'border-left-style')).toBe('solid');
    expect(computed('p { flex-grow: 2; flex-grow: -5 }', 'flex-grow')).toBe('2');
  });
  it('弱い規則の読める宣言が、強い規則の読めない宣言に負けない。継ぐ性質は、親の値を継ぐ', () => {
    expect(computed('p { word-break: keep-all } #a { word-break: zzz }', 'word-break')).toBe('keep-all');
    expect(computed('body { line-break: strict } p { line-break: zzz }', 'line-break')).toBe('strict');
    expect(computed('body { font-kerning: none } p { font-kerning: 12qq }', 'font-kerning')).toBe('none');
  });
  it('一括指定の分け方: 合わない値は空 (宣言ごと読めない)', () => {
    expect(expand('text-decoration', 'underline zzz')).toEqual([]);
    expect(expand('flex', '1 2 3 4 5 6 7')).toEqual([]);
    expect(expand('flex', '1 1 0')).toEqual([['flex-grow', '1'], ['flex-shrink', '1'], ['flex-basis', '0%']]);
    expect(expand('columns', '2 3')).toEqual([]);
    expect(expand('list-style', 'disc circle')).toEqual([]);
    expect(expand('text-decoration', 'underline dotted red 2px')).toEqual([['text-decoration-line', 'underline'], ['text-decoration-style', 'dotted'], ['text-decoration-color', 'red'], ['text-decoration-thickness', '2px']]);
  });
});

describe('PKG-19 自前で読む宣言 (htmlPaged) の値の文法', () => {
  const PAGED: Record<string, [string[], string[]]> = {
    page: [['auto', 'chapter', 'TOC'], ['12qq', '-5', 'a b', '"str"']],
    'bookmark-level': [['none', '1', '4'], ['zzz', '0', '-5', '1 2']],
    'bookmark-state': [['open', 'closed'], ['zzz', 'open closed']],
    'text-autospace': [['normal', 'auto', 'no-autospace', 'ideograph-alpha', 'ideograph-alpha ideograph-numeric', 'punctuation insert', 'replace'], ['zzz', 'no-autospace ideograph-alpha', 'insert replace', '12qq']],
    'text-spacing-trim': [['normal', 'space-all', 'space-first', 'trim-start', 'trim-both', 'trim-all', 'auto'], ['zzz', 'trim-start trim-both', '-5']],
    'text-spacing': [['none', 'auto', 'trim-start', 'no-autospace', 'trim-both ideograph-alpha', 'ideograph-numeric space-all'], ['zzz', 'none auto', 'trim-start trim-both', '12qq']],
    'hanging-punctuation': [['none', 'first', 'last', 'allow-end', 'first force-end last', 'last first'], ['zzz', 'force-end allow-end', 'none first', 'first first']],
    'ruby-position': [['over', 'under', 'alternate over', 'inter-character'], ['zzz', 'over under']],
    'ruby-align': [['start', 'center', 'space-between', 'space-around'], ['zzz', 'start center']],
    'ruby-merge': [['separate', 'merge'], ['zzz']],
    'ruby-overhang': [['auto', 'none'], ['zzz', '12qq']],
    'alignment-baseline': [['baseline', 'alphabetic', 'ideographic', 'middle', 'central', 'mathematical', 'text-top', 'text-bottom'], ['zzz', '12qq', 'middle central']],
  };
  for (const [prop, [good, bad]] of Object.entries(PAGED)) {
    it(`${prop}: @supports は、文法に合う値だけ真`, () => {
      for (const v of good) expect(matchSupports(`(${prop}: ${v})`), `${prop}: ${v}`).toBe(true);
      for (const v of bad) {
        expect(validPagedValue(prop, v), `${prop}: ${v}`).toBe(false);
        expect(matchSupports(`(${prop}: ${v})`), `@supports ${prop}: ${v}`).toBe(false);
      }
      expect(validPagedValue(prop, 'inherit')).toBe(true);
    });
  }
  it('文法を調べない性質 (string-set・bookmark-label・接頭辞の付いた名前) は、これまでどおり', () => {
    for (const [p, v] of [['string-set', 'title content()'], ['bookmark-label', 'content()'], ['-ah-hanging-punctuation', 'start end'], ['-ah-text-autospace', 'ideograph-alpha']]) {
      expect(validPagedValue(p, v), `${p}: ${v}`).toBe(true);
      expect(matchSupports(`(${p}: ${v})`), `${p}: ${v}`).toBe(true);
    }
  });
  it('--style ah では、自前で読む宣言の値を調べない (拡張の値を含む宣言を、これまでどおり読む)', () => {
    expect(matchSupports('(hanging-punctuation: allow-end end)', ALL_AH)).toBe(true);
    expect(matchSupports('(hanging-punctuation: allow-end end)')).toBe(false);
  });
  it('文法に合わない宣言は、前の宣言を打ち消さない (ルビの位置・ぶら下げ)', () => {
    const run = (css: string, body: string) => {
      const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
      return JSON.stringify(importHtml(d, cascadeStyles(d, css, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 } }), { css }).document.sequences[0]);
    };
    const ruby = '<p><ruby>漢<rt>かん</rt></ruby></p>';
    expect(run('ruby { ruby-position: under }', ruby)).toContain('"rubyPosition":"under"');
    expect(run('ruby { ruby-position: under } p ruby { ruby-position: zzz }', ruby)).toContain('"rubyPosition":"under"');
    expect(run('body { hanging-punctuation: allow-end }', '<p>a</p>')).toContain('"hangingPunctuation":true');
    expect(run('body { hanging-punctuation: allow-end } html body { hanging-punctuation: zzz }', '<p>a</p>')).toContain('"hangingPunctuation":true');
  });
});
