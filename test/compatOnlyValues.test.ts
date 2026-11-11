/**
 * 接頭辞の無い名前 (標準のプロパティ・属性) に足された、アンテナハウスの拡張の値は、互換の指定 (HTML は --style ah、XSL-FO は
 * --compat antenna) のときだけ読む (PKG-20。CLAUDE.md の「仕様の根拠」)。互換の指定の無いときは、仕様どおり無効の値として扱い、警告に出す。
 * 接頭辞・名前空間の付いた名前 (-ah-float・-ah-text-align・axf:diagonal-border) に書いた値は、どのモードでも読む。
 *  - HTML: float の top・bottom・start・end・inside・outside・center・alternate・multicol・sidenote (CSS の値は CSS 2.1 §9.5.1 の left・right・none、
 *    Logical 1 §2.1 の inline-start・inline-end、GCPM 3 §2.4 の footnote)、width の <数>gr (CSS Values 4 の単位に無い)、
 *    text-align の inside・outside (CSS Text 3 §6.1 に無い)、色の cmyk()・rgb-icc() (CSS の関数は Color 5 §12.1 の device-cmyk())
 *  - XSL-FO: 線種 dot-dash・dot-dot-dash・wave (XSL 1.1 §7.8.20 の <border-style> に無い)、force-page-count の数 (§7.27.6 に無い)
 *  - @supports の答えは、実際に受け付けるかと一致させる (Conditional 3 §6.1)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { DEFAULT_FONTS, typesetHtml } from '../src/index';
import { cascadeStyles, HTML_UA_CSS, ALL_AH } from '../src/cssCascade';
import { importHtml, type HtmlImportOptions } from '../src/htmlImport';
import { compatOnlyValue, isPagedDecl, matchSupports, parseCss, printColor } from '../src/htmlPaged';
import { importXslFo, type ImportOptions } from '../src/xslfoImport';
import { AH_HTML_IMPORT_OPTIONS, ahCascadeOptions } from '../src/compat';
import type { LBlock } from '../src/types';
import { ensureFonts, loadCachedFont } from './helpers';

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
}, 300_000);

/** HTML を論理ツリーにする (ah: アンテナハウス互換の設定)。返すのは、ツリーの JSON と、未対応の報告 */
function html(body: string, css: string, ah = false, opts: Partial<HtmlImportOptions> = {}) {
  const d = new DOMParser().parseFromString(`<html><head><title>t</title></head><body>${body}</body></html>`, 'text/html') as unknown as Document;
  // CSS は、公開の API (prepareHtml) と同じく、互換の設定で 1 度読んだものを、カスケードと読み込みの両方に渡す (@supports の答えをそろえる)
  const sheet = parseCss(css, undefined, ah ? ALL_AH : undefined);
  const styles = cascadeStyles(d, sheet, { uaCss: HTML_UA_CSS, viewport: { width: 600, height: 800 }, ...(ah ? ahCascadeOptions(sheet) : {}) });
  const r = importHtml(d, styles, { css, sheet, ...(ah ? AH_HTML_IMPORT_OPTIONS : {}), ...opts });
  return { json: JSON.stringify(r.document.sequences[0].flow), unsupported: r.report.unsupported, doc: r.document };
}
/** ツリーの中の float の側の並び */
const floats = (json: string) => [...json.matchAll(/"type":"float","float":"([a-z]+)"/g)].map((m) => m[1]);
const COMPAT = ' (--style ah のときだけ解釈する値)';

describe('PKG-20 HTML: 接頭辞の無い float に書いたアンテナハウスの拡張の値', () => {
  const body = '<p>a</p><div class="f">F</div><p>b</p>';
  it('float: top・bottom・inside・outside・start・end・center・alternate は、既定では無効の値 (回り込みにならない) で、警告に出る', () => {
    for (const v of ['top', 'bottom', 'inside', 'outside', 'start', 'end', 'center', 'alternate', 'top page', 'bottom column', 'multicol top', 'sidenote']) {
      const r = html(body, `.f { float: ${v} }`);
      expect(floats(r.json), v).toEqual([]);
      expect(r.unsupported[`float: ${v}${COMPAT}`], v).toBe(1);
    }
  });
  it('--style ah では、これまでどおり読む (警告は出ない)', () => {
    const side: Record<string, string> = { top: 'before', bottom: 'after', inside: 'inside', outside: 'outside', start: 'start', end: 'end', center: 'center', alternate: 'alternate', 'top page': 'before', sidenote: 'end' };
    for (const [v, f] of Object.entries(side)) {
      const r = html(body, `.f { float: ${v} }`, true);
      expect(floats(r.json), v).toEqual([f]);
      expect(Object.keys(r.unsupported).filter((k) => k.startsWith('float')), v).toEqual([]);
    }
  });
  it('接頭辞の付いた -ah-float に書けば、どのスタイルでも読む (規則でも style 属性でも)', () => {
    for (const ah of [false, true]) {
      expect(floats(html(body, '.f { -ah-float: top }', ah).json)).toEqual(['before']);
      expect(floats(html(body, '.f { -ah-float: outside }', ah).json)).toEqual(['outside']);
      expect(floats(html('<p>a</p><div style="-ah-float: bottom">F</div>', '', ah).json)).toEqual(['after']);
    }
    // style 属性の接頭辞の無い float: top は、既定では捨てて報告する
    const r = html('<p>a</p><div style="float: top">F</div>', '');
    expect(floats(r.json)).toEqual([]);
    expect(r.unsupported[`float: top${COMPAT}`]).toBe(1);
  });
  it('無効の値の宣言は、前の宣言を打ち消さない (CSS 2.1 §4.2): float: left や float: footnote が残る', () => {
    expect(floats(html(body, '.f { float: left; float: top }').json)).toEqual(['start']);
    expect(floats(html(body, '.f { float: left } div.f { float: outside }').json)).toEqual(['start']);
    expect(html('<p>a<span class="f">注</span></p>', '.f { float: footnote } span.f { float: top }').json).toContain('"type":"footnote"');
    // 互換の指定のときは、後の (強い) 宣言の top が勝つ
    expect(floats(html(body, '.f { float: left } div.f { float: top }', true).json)).toEqual(['before']);
  });
  it('CSS の値 (left・right・inline-start・inline-end・footnote) は、どちらのスタイルでも読む', () => {
    for (const ah of [false, true]) {
      expect(floats(html(body, '.f { float: right }', ah).json)).toEqual(['end']);
      expect(floats(html(body, '.f { float: inline-end }', ah).json)).toEqual(['end']);
      expect(html('<p>a<span class="f">注</span></p>', '.f { float: footnote }', ah).json).toContain('"type":"footnote"');
    }
  });
});

describe('PKG-20 HTML: width の gr・text-align の inside / outside・色の cmyk() / rgb-icc()', () => {
  it('width: <数>gr は、既定では無効の値で、警告に出る (-ah-float: multicol top の箱は、段の幅いっぱいになる)', () => {
    const body = '<div class="m"><p>a</p><div class="f">F</div><p>b</p></div>';
    const css = 'div.m { column-count: 3; column-gap: 10pt; width: 320pt } .f { -ah-float: multicol top; width: 1gr }';
    /** 段をまたぐ箱 (span: all) の幅 */
    const widthOf = (json: string) => {
      let w: number | undefined;
      JSON.parse(json, (_k, v) => (v && v.span === 'all' && (w = v.width), v));
      return w;
    };
    const d = html(body, css);
    expect(d.unsupported[`width: <数>gr${COMPAT}`]).toBe(1);
    expect(d.json).toContain('"span":"all"');
    expect(widthOf(d.json)).toBeUndefined();
    const a = html(body, css, true);
    expect(Object.keys(a.unsupported).filter((k) => k.startsWith('width'))).toEqual([]);
    expect(widthOf(a.json)).toBeCloseTo(100, 1);
  });
  it('text-align: inside・outside は、既定では無効の値で警告に出る。-ah-text-align に書けば、どのスタイルでも読む', () => {
    const d = html('<p class="t">a</p>', '.t { text-align: outside }');
    expect(d.json).not.toContain('"textAlign":"outside"');
    expect(d.unsupported[`text-align: outside${COMPAT}`]).toBe(1);
    expect(html('<p class="t">a</p>', '.t { text-align: outside }', true).json).toContain('"textAlign":"outside"');
    for (const ah of [false, true]) expect(html('<p class="t">a</p>', '.t { -ah-text-align: inside }', ah).json).toContain('"textAlign":"inside"');
  });
  it('色の cmyk()・rgb-icc() は、既定では無効の値 (前の宣言・継いだ色を使う) で、警告に出る。device-cmyk() はどちらでも読む', () => {
    const css = '.c { color: cmyk(0, 1, 1, 0) } .r { color: #0000ff; color: rgb-icc(255, 0, 0, #CMYK, 0, 1, 1, 0) } .d { color: device-cmyk(0 1 1 0) } .b { border: 2px solid; border-color: cmyk(1, 0, 0, 0); background-color: rgb-icc(#Grayscale, 0.5) }';
    const body = '<p class="c">c</p><p class="r">r</p><p class="d">d</p><p class="b">b</p>';
    const d = html(body, css);
    // device-cmyk() の 1 つだけが CMYK になる。.r は前の宣言の青
    expect(d.json.match(/cmyk\([^)]*\)/g)).toEqual(['cmyk(0,1,1,0)']);
    expect(d.json).toContain('"color":"#0000ff"');
    expect(d.json).not.toContain('gray(');
    expect(d.unsupported[`color: cmyk()${COMPAT}`]).toBe(1);
    expect(d.unsupported[`color: rgb-icc()${COMPAT}`]).toBe(1);
    expect(d.unsupported[`border-color: cmyk()${COMPAT}`]).toBe(1);
    expect(d.unsupported[`background-color: rgb-icc()${COMPAT}`]).toBe(1);
    const a = html(body, css, true);
    expect(a.json.match(/cmyk\([^)]*\)/g)).toEqual(['cmyk(0,1,1,0)', 'cmyk(0,1,1,0)', 'cmyk(1,0,0,0)', 'cmyk(1,0,0,0)', 'cmyk(1,0,0,0)', 'cmyk(1,0,0,0)']);
    // (.r は、前の宣言の青のまま: 前に同じ性質の読める宣言があるときの rgb-icc() は、特色の値が渡されたときだけ使う)
    expect(a.json).toContain('gray(0.5)');
    expect(Object.keys(a.unsupported).filter((k) => /cmyk|rgb-icc/.test(k))).toEqual([]);
  });
  it('特色 (rgb-icc の #Separation) も、既定では読まない。--style ah では特色にする', () => {
    const css = "p { color: rgb(0, 61, 25); color: rgb-icc(0, 61, 25, #Separation, 'Ink A') }";
    const spotColors = { 'Ink A': [0.2, 0.4, 0.6, 0.8] as [number, number, number, number] };
    expect(html('<p>a</p>', css, false, { spotColors }).json).not.toContain('spot(');
    expect(html('<p>a</p>', css, true, { spotColors }).json).toContain('spot(');
  });
  it('@page と余白の箱の色も同じ (printColor は、互換の指定の無いときは device-cmyk() だけを読む)', () => {
    expect(printColor('cmyk(0, 1, 1, 0)')).toBe('cmyk(0,1,1,0)');
    expect(printColor('cmyk(0, 1, 1, 0)', undefined, false)).toBeUndefined();
    expect(printColor('rgb-icc(255, 0, 0, #CMYK, 0, 1, 1, 0)', undefined, false)).toBeUndefined();
    expect(printColor('device-cmyk(0 1 1 0)', undefined, false)).toBe('cmyk(0,1,1,0)');
    const css = '@page { size: A5; background-color: cmyk(0, 0, 0.2, 0); @top-center { content: "x"; color: rgb-icc(#CMYK, 0, 1, 1, 0) } }';
    const d = html('<p>a</p>', css);
    expect(d.doc.sequences[0].master.backgroundColor).toBeUndefined();
    expect(d.unsupported[`background-color: cmyk()${COMPAT}`]).toBe(1);
    expect(d.unsupported[`color: rgb-icc()${COMPAT}`]).toBe(1);
    const a = html('<p>a</p>', css, true);
    expect(a.doc.sequences[0].master.backgroundColor).toBe('cmyk(0,0,0.2,0)');
    expect(JSON.stringify(a.doc.sequences[0].staticContent)).toContain('"color":"cmyk(0,1,1,0)"');
    expect(JSON.stringify(d.doc.sequences[0].staticContent)).not.toContain('cmyk(');
  });
  it('警告は、typesetHtml の warnings に出る (既定のスタイルだけ)', async () => {
    const src = '<!doctype html><html><head><style>.f { float: top } .c { color: cmyk(0,1,1,0) }</style></head><body><p class="c">a</p><div class="f">F</div></body></html>';
    const d = await typesetHtml(src, { loadFont: loadCachedFont });
    expect(d.warnings.join('\n')).toMatch(/float: top \(--style ah のときだけ解釈する値\)/);
    expect(d.warnings.join('\n')).toMatch(/color: cmyk\(\) \(--style ah のときだけ解釈する値\)/);
    const a = await typesetHtml(src, { loadFont: loadCachedFont, style: 'ah' });
    expect(a.warnings.join('\n')).not.toMatch(/--style ah のときだけ/);
  });
});

describe('PKG-20 拡張の値の見分け (compatOnlyValue) と @supports', () => {
  it('compatOnlyValue: 接頭辞の無い名前に書いた拡張の値だけ', () => {
    for (const [p, v] of [['float', 'top'], ['float', 'multicol top'], ['float', 'Outside'], ['width', '2.5gr'], ['text-align', 'inside'], ['color', 'cmyk(0,0,0,1)'], ['background', 'rgb-icc(#CMYK,0,0,0,1)'], ['border-left-color', 'cmyk(1,0,0,0)'], ['-kumiori-print-color', "rgb-icc(0,0,0,#Separation,'A')"]])
      expect(compatOnlyValue(p, v), `${p}: ${v}`).toBeTruthy();
    for (const [p, v] of [['float', 'left'], ['float', 'inline-start'], ['float', 'footnote'], ['float', 'zzz'], ['width', '2em'], ['text-align', 'justify'], ['color', 'device-cmyk(0 0 0 1)'], ['-ah-float', 'top'], ['-ah-text-align', 'inside'], ['content', '"cmyk(0,0,0,1)"']])
      expect(compatOnlyValue(p, v), `${p}: ${v}`).toBeUndefined();
  });
  it('@supports の答えは、実際に受け付けるかと同じ: 拡張の値は互換の指定のときだけ真、接頭辞つきと CSS の値はどちらでも真', () => {
    for (const c of ['float: top', 'float: multicol top', 'float: outside', 'width: 3gr', 'text-align: inside', 'color: cmyk(0, 0, 0, 1)', "background-color: rgb-icc(0, 0, 0, #Separation, 'A')", 'border-color: cmyk(1, 0, 0, 0)']) {
      expect(matchSupports(`(${c})`), c).toBe(false);
      expect(matchSupports(`(${c})`, ALL_AH), `${c} (ah)`).toBe(true);
      expect(matchSupports(`not (${c})`), `not ${c}`).toBe(true);
    }
    for (const ah of [undefined, ALL_AH]) {
      for (const c of ['float: footnote', 'float: left', 'float: inline-end', '-ah-float: top', '-ah-text-align: outside', 'color: device-cmyk(0 0 0 1)', 'width: 3em']) expect(matchSupports(`(${c})`, ah), c).toBe(true);
      // 知らない語の float は、どちらのときも偽 (以前は真と答えていた)
      expect(matchSupports('(float: zzz)', ah)).toBe(false);
    }
    expect(isPagedDecl('float', 'zzz')).toBe(false);
    expect(isPagedDecl('float', 'top page')).toBe(true);
  });
  it('@supports の中の規則は、既定では効かず、--style ah では効く', () => {
    const css = '@supports (float: top) { p { margin-left: 30pt } } @supports (color: cmyk(0,0,0,1)) { p { margin-right: 20pt } }';
    const run = (ah: boolean) => {
      const m = (html('<p>a</p>', css, ah).doc.sequences[0].flow.children[0] as LBlock & { children: LBlock[] }).children[0].margin as { left?: number; right?: number } | undefined;
      return [Math.round(m?.left ?? 0), Math.round(m?.right ?? 0)];
    };
    expect(run(false)).toEqual([0, 0]);
    expect(run(true)).toEqual([30, 20]);
  });
});

describe('PKG-20 (8) --style ah の counter() の拡張', () => {
  it('counter(c reverse) (page でないカウンタの physical・reverse) は、互換のカスケードも読めない宣言として捨てる (前の宣言を使う)', () => {
    const css = 'body { counter-reset: c 7 } p::before { content: "[" counter(c) "]"; content: counter(c reverse) }';
    for (const ah of [false, true]) expect(html('<p>a</p>', css, ah).json.replace(/","/g, ''), String(ah)).toContain('[7]');
  });
  it('counter(page reverse) は、互換のときに受け付けるが組めないので、未対応として知らせる', () => {
    const css = 'p::before { content: counter(page reverse) }';
    expect(html('<p>a</p>', css, true).unsupported['content: counter(page reverse)']).toBe(1);
    expect(matchSupports('(content: counter(c reverse))', ALL_AH)).toBe(false);
    expect(matchSupports('(content: counter(page physical))', ALL_AH)).toBe(true);
  });
});

describe('PKG-20 XSL-FO: 標準の属性に足されたアンテナハウスの値', () => {
  const parse = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as never;
  const NS = 'xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:axf="http://www.antennahouse.com/names/XSL/Extensions"';
  const PM = '<fo:layout-master-set><fo:simple-page-master master-name="m" page-width="100mm" page-height="100mm" margin="10mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>';
  const fo = (flow: string, extra = '') => `<?xml version="1.0"?><fo:root ${NS}>${PM}<fo:page-sequence master-reference="m" ${extra}><fo:flow flow-name="xsl-region-body">${flow}</fo:flow></fo:page-sequence></fo:root>`;
  const imp = (xml: string, compat: ImportOptions['compat']) => importXslFo(xml, parse, { compat });
  const first = (xml: string, compat: ImportOptions['compat']) => {
    const r = imp(xml, compat);
    return { b: r.document.sequences[0].flow.children[0] as LBlock, unsupported: r.report.unsupported };
  };
  const ANT = ' (--compat antenna のときだけ解釈する値)';

  it('線種 dot-dash・dot-dot-dash・wave (XSL 1.1 §7.8.20 に無い値) は、仕様モードでは無効の値 (罫線は引かない) で、警告に出る。互換モードでは読む', () => {
    for (const st of ['dot-dash', 'dot-dot-dash', 'wave']) {
      const xml = fo(`<fo:block border-top-style="${st}" border-top-width="1pt">a</fo:block>`);
      const s = first(xml, 'spec');
      expect(s.b.border, st).toBeUndefined();
      expect(s.unsupported[`border-top-style="${st}"${ANT}`], st).toBe(1);
      const a = first(xml, 'antenna');
      expect((a.b.border as { top: { style: string } }).top.style, st).toBe(st);
      expect(Object.keys(a.unsupported).filter((k) => k.startsWith('border')), st).toEqual([]);
    }
    // border-style (4 辺) と、相対の辺 (border-after-style)
    const s = first(fo('<fo:block border-style="wave" border-width="1pt" border-after-style="dot-dash">a</fo:block>'), 'spec');
    expect(s.b.border).toBeUndefined();
    expect(s.unsupported[`border-style="wave"${ANT}`]).toBe(1);
    expect(s.unsupported[`border-after-style="dot-dash"${ANT}`]).toBe(1);
  });
  it('(9) 一括指定 border="1pt dot-dash red" は、互換モードでは罫線になる。仕様モードでは無効の値として警告に出る (以前は、どちらのモードでも黙って消えた)', () => {
    const xml = fo('<fo:block border="1pt dot-dash red">a</fo:block>');
    const a = first(xml, 'antenna');
    expect(a.b.border).toMatchObject({ top: { width: 1, color: 'red', style: 'dot-dash' }, left: { width: 1, color: 'red', style: 'dot-dash' } });
    const s = first(xml, 'spec');
    expect(s.b.border).toBeUndefined();
    expect(s.unsupported[`border="… dot-dash …"${ANT}`]).toBe(1);
    // 辺の一括指定 (border-bottom・border-after) も同じ。無効の一括指定は書かなかったものとして、ほかの指定を使う
    const m = first(fo('<fo:block border="2pt solid blue" border-bottom="1pt wave red">a</fo:block>'), 'spec');
    expect(m.b.border).toMatchObject({ bottom: { width: 2, color: 'blue' } });
    expect(m.unsupported[`border-bottom="… wave …"${ANT}`]).toBe(1);
    expect(first(fo('<fo:block border="2pt solid blue" border-bottom="1pt wave red">a</fo:block>'), 'antenna').b.border).toMatchObject({ bottom: { width: 1, color: 'red', style: 'wave' } });
  });
  it('仕様の線種はどちらのモードでも読む。どちらの値でもない線種は、どちらのモードでも書かなかったものとして報告する', () => {
    for (const compat of ['spec', 'antenna'] as const) {
      expect((first(fo('<fo:block border="1pt dashed green">a</fo:block>'), compat).b.border as { top: { style: string } }).top.style).toBe('dashed');
      const z = first(fo('<fo:block border-style="zigzag" border-width="1pt">a</fo:block>'), compat);
      expect(z.b.border).toBeUndefined();
      expect(z.unsupported['border-style="zigzag"']).toBe(1);
    }
  });
  it('axf: の付いた属性 (axf:diagonal-border) に書いた拡張の線種は、どちらのモードでも読む', () => {
    for (const compat of ['spec', 'antenna'] as const) {
      const r = first(fo('<fo:block axf:diagonal-border="1pt wave red">a</fo:block>'), compat);
      expect((r.b as unknown as { diagonalBorder: unknown }).diagonalBorder).toMatchObject({ width: 1, color: 'red', style: 'wave' });
    }
  });
  it('force-page-count の数 (§7.27.6 に無い値) は、互換モードのときだけ読む', () => {
    const xml = fo('<fo:block>a</fo:block>', 'force-page-count="3"');
    const s = imp(xml, 'spec');
    expect(s.document.sequences[0].forcePageCount).toBeUndefined();
    expect(s.report.unsupported[`force-page-count="3"${ANT}`]).toBe(1);
    expect(imp(xml, 'antenna').document.sequences[0].forcePageCount).toBe(3);
    expect(imp(fo('<fo:block>a</fo:block>', 'force-page-count="end-on-even"'), 'spec').document.sequences[0].forcePageCount).toBe('end-on-even');
  });
});
